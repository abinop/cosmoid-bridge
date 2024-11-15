const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const noble = require('@abandonware/noble');
const { ipcMain } = require('electron');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    
    // Cosmo device UUIDs - stored without hyphens for noble compatibility
    this.DEVICE_INFO_SERVICE_UUID = '0000180a0000100080000805f9b34fb';
    this.SERIAL_CHARACTERISTIC_UUID = '00002a250000100080000805f9b34fb';
    this.FIRMWARE_CHARACTERISTIC_UUID = '00002a260000100080000805f9b34fb';
    this.COSMO_SERVICE_UUID = '000015231212efde1523785feabcd123';
    this.SENSOR_CHARACTERISTIC_UUID = '000015241212efde1523785feabcd123';
    this.BUTTON_STATUS_CHARACTERISTIC_UUID = '000015251212efde1523785feabcd123';
    this.COMMAND_CHARACTERISTIC_UUID = '000015281212efde1523785feabcd123';
    
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : '/var/local');
    this.logPath = path.join(appDataPath, 'Cosmoid Bridge', 'debug.log');
    
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.setupNoble();
    this.setupIPC();
    this.log('BLEManager', 'Initialized');
  }

  setupIPC() {
    ipcMain.on('requestDevices', () => {
      this.emitAllDevices();
    });
  }

  setupNoble() {
    noble.on('stateChange', (state) => {
      this.log('Bluetooth state changed', state);
      if (state === 'poweredOn' && this.isScanning) {
        this.startActualScan();
      }
    });

    noble.on('discover', async (peripheral) => {
      // Only process and log Cosmo devices
      if (peripheral.advertisement.localName?.includes('Cosmo')) {
        this.log('Cosmo device found', {
          name: peripheral.advertisement.localName,
          uuid: peripheral.uuid,
          rssi: peripheral.rssi
        });
        
        try {
          await peripheral.connectAsync();
          this.log('Connected to device', peripheral.uuid);

          const services = await peripheral.discoverServicesAsync();
          
          const cosmoService = services.find(s => s.uuid === this.COSMO_SERVICE_UUID);
          const deviceInfoService = services.find(s => s.uuid === '180a');
          const batteryService = services.find(s => s.uuid === '180f');

          if (!cosmoService) {
            throw new Error('Cosmo service not found');
          }

          let deviceInfo = {
            id: peripheral.uuid,
            name: peripheral.advertisement.localName,
            serial: null,
            firmware: null,
            batteryLevel: null,
            rssi: peripheral.rssi,
            connected: true
          };

          if (deviceInfoService) {
            const characteristics = await deviceInfoService.discoverCharacteristicsAsync();
            for (const char of characteristics) {
              try {
                if (char.uuid === '2a25') { // Serial Number
                  const data = await char.readAsync();
                  deviceInfo.serial = data.toString().trim();
                } else if (char.uuid === '2a26') { // Firmware
                  const data = await char.readAsync();
                  deviceInfo.firmware = data.toString().trim();
                }
              } catch (charError) {
                this.log('Error reading characteristic', {
                  uuid: char.uuid,
                  error: charError.toString()
                });
              }
            }
          }

          if (batteryService) {
            try {
              const characteristics = await batteryService.discoverCharacteristicsAsync();
              const batteryChar = characteristics.find(c => c.uuid === '2a19');
              if (batteryChar) {
                const data = await batteryChar.readAsync();
                deviceInfo.batteryLevel = data[0];

                await batteryChar.subscribeAsync();
                batteryChar.on('data', (data) => {
                  deviceInfo.batteryLevel = data[0];
                  this.updateDeviceInfo(peripheral.uuid, { batteryLevel: data[0] });
                });
              }
            } catch (error) {
              this.log('Error reading battery service', error);
            }
          }

          // Store the complete device info
          this.devices.set(peripheral.uuid, {
            ...deviceInfo,
            peripheral,
            service: cosmoService
          });

          // Emit to renderer
          this.emitDeviceUpdate(deviceInfo);

          // Set up Cosmo service characteristics
          const characteristics = await cosmoService.discoverCharacteristicsAsync();
          
          for (const char of characteristics) {
            if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID || 
                char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
              try {
                await char.subscribeAsync();
                char.on('data', (data) => {
                  if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID) {
                    this.updateDeviceInfo(peripheral.uuid, { sensorValue: data[0] });
                  } else if (char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
                    this.updateDeviceInfo(peripheral.uuid, { 
                      buttonState: data[0],
                      pressValue: data[1]
                    });
                  }
                });
              } catch (subError) {
                this.log('Error subscribing to characteristic', {
                  uuid: char.uuid,
                  error: subError.toString()
                });
              }
            }
          }

        } catch (error) {
          this.log('Error connecting to device', {
            error: error.toString(),
            stack: error.stack
          });
        }
      }
    });

    // Handle disconnection
    noble.on('disconnect', async (peripheral) => {
      this.log('Device disconnected', peripheral.uuid);
      if (this.devices.has(peripheral.uuid)) {
        const deviceInfo = this.devices.get(peripheral.uuid);
        deviceInfo.connected = false;
        this.emitDeviceUpdate(deviceInfo);
      }
    });
  }

  updateDeviceInfo(deviceId, updates) {
    const device = this.devices.get(deviceId);
    if (device) {
      Object.assign(device, updates);
      this.emitDeviceUpdate(device);
    }
  }

  emitDeviceUpdate(deviceInfo) {
    // Send to all renderer processes
    const cleanDeviceInfo = {
      id: deviceInfo.id,
      name: deviceInfo.name,
      serial: deviceInfo.serial,
      firmware: deviceInfo.firmware,
      batteryLevel: deviceInfo.batteryLevel,
      sensorValue: deviceInfo.sensorValue,
      pressValue: deviceInfo.pressValue,
      buttonState: deviceInfo.buttonState,
      rssi: deviceInfo.rssi,
      connected: deviceInfo.connected
    };
    
    this.log('Emitting device update', cleanDeviceInfo);
    global.mainWindow?.webContents.send('deviceUpdate', cleanDeviceInfo);
  }

  emitAllDevices() {
    const devices = Array.from(this.devices.values()).map(device => ({
      id: device.id,
      name: device.name,
      serial: device.serial,
      firmware: device.firmware,
      batteryLevel: device.batteryLevel,
      sensorValue: device.sensorValue,
      pressValue: device.pressValue,
      buttonState: device.buttonState,
      rssi: device.rssi,
      connected: device.connected
    }));
    
    this.log('Emitting all devices', devices);
    global.mainWindow?.webContents.send('deviceList', devices);
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
    console.log(logMessage);
    fs.appendFileSync(this.logPath, logMessage);
  }

  startActualScan() {
    noble.startScanningAsync([], false)
      .then(() => {
        this.log('Scanning started', null);
      })
      .catch((error) => {
        this.log('Error starting scan', {
          error: error.toString(),
          stack: error.stack
        });
      });
  }

  async startScanning() {
    if (this.isScanning) {
      this.log('startScanning', 'Already scanning');
      return;
    }

    this.isScanning = true;
    this.devices.clear();
    this.emitAllDevices(); // Clear the UI list

    try {
      if (noble.state === 'poweredOn') {
        await this.startActualScan();
      } else {
        this.log('Bluetooth not powered on', noble.state);
      }
    } catch (error) {
      this.log('Error scanning', {
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }

  async stopScanning() {
    this.isScanning = false;
    try {
      await noble.stopScanningAsync();
      this.log('Stopped scanning', null);
    } catch (error) {
      this.log('Error stopping scan', {
        error: error.toString(),
        stack: error.stack
      });
    }
  }

  async setColor(deviceId, r, g, b, mode = 1) {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error('Device not found');
    }

    try {
      const commandChar = deviceInfo.service.characteristics.find(c => c.uuid === this.COMMAND_CHARACTERISTIC_UUID);
      if (!commandChar) {
        throw new Error('Command characteristic not found');
      }

      const command = Buffer.from([2, r, g, b, mode]); // 2 is SET_COLOR command
      await commandChar.writeAsync(command, true);
      this.log('Color set', { r, g, b, mode });
    } catch (error) {
      this.log('Error setting color', {
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }

  async setBrightness(deviceId, intensity, delay = 1) {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error('Device not found');
    }

    try {
      const commandChar = deviceInfo.service.characteristics.find(c => c.uuid === this.COMMAND_CHARACTERISTIC_UUID);
      if (!commandChar) {
        throw new Error('Command characteristic not found');
      }

      const command = Buffer.from([1, intensity, delay]); // 1 is SET_LUMINOSITY command
      await commandChar.writeAsync(command, true);
      this.log('Brightness set', { intensity, delay });
    } catch (error) {
      this.log('Error setting brightness', {
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new BLEManager();