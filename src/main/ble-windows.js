const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const noble = require('@abandonware/noble');
const { ipcMain } = require('electron');
const EventEmitter = require('events');

class BLEManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this._scanning = false;
    this._connectionCheckInterval = null;
    
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
      if (state === 'poweredOn' && this._scanning) {
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
          // Set up disconnect handler before connecting
          peripheral.once('disconnect', () => {
            this.log('Device disconnected', peripheral.uuid);
            const device = this.devices.get(peripheral.uuid);
            if (device) {
              device.connected = false;
              this.emit('deviceDisconnected', {
                id: peripheral.uuid,
                name: device.name
              });
              // Remove device from map
              this.devices.delete(peripheral.uuid);
              this.emit('deviceUpdate', device);
            }
          });

          await peripheral.connectAsync();
          this.log('Connected to device', peripheral.uuid);

          this.log('Discovering services...', peripheral.uuid);
          const services = await peripheral.discoverServicesAsync();
          this.log('Services discovered', services.map(s => s.uuid));
          
          const cosmoService = services.find(s => s.uuid === this.COSMO_SERVICE_UUID);
          const deviceInfoService = services.find(s => s.uuid === '180a');
          const batteryService = services.find(s => s.uuid === '180f');

          if (!cosmoService) {
            throw new Error(`Cosmo service not found. Available services: ${services.map(s => s.uuid).join(', ')}`);
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
            try {
              this.log('Discovering device info characteristics...', peripheral.uuid);
              const characteristics = await deviceInfoService.discoverCharacteristicsAsync();
              this.log('Device info characteristics discovered', characteristics.map(c => c.uuid));
              
              for (const char of characteristics) {
                try {
                  if (char.uuid === '2a25') { // Serial Number
                    const data = await char.readAsync();
                    deviceInfo.serial = data.toString().trim();
                    this.log('Serial Number read', deviceInfo.serial);
                    this.emit('propertyUpdate', {
                      deviceId: peripheral.uuid,
                      property: 'serial',
                      value: deviceInfo.serial
                    });
                  } else if (char.uuid === '2a26') { // Firmware
                    const data = await char.readAsync();
                    deviceInfo.firmware = data.toString().trim();
                    this.log('Firmware Version read', deviceInfo.firmware);
                    this.emit('propertyUpdate', {
                      deviceId: peripheral.uuid,
                      property: 'firmware',
                      value: deviceInfo.firmware
                    });
                  }
                } catch (charError) {
                  this.log('Error reading characteristic', {
                    uuid: char.uuid,
                    error: charError.toString(),
                    stack: charError.stack
                  });
                }
              }
            } catch (error) {
              this.log('Error discovering device info characteristics', {
                error: error.toString(),
                stack: error.stack
              });
            }
          }

          if (batteryService) {
            try {
              this.log('Discovering battery characteristics...', peripheral.uuid);
              const characteristics = await batteryService.discoverCharacteristicsAsync();
              this.log('Battery characteristics discovered', characteristics.map(c => c.uuid));
              
              const batteryChar = characteristics.find(c => c.uuid === '2a19');
              if (batteryChar) {
                const data = await batteryChar.readAsync();
                deviceInfo.batteryLevel = data[0];
                this.log('Battery Level read', deviceInfo.batteryLevel);
                this.emit('propertyUpdate', {
                  deviceId: peripheral.uuid,
                  property: 'batteryLevel',
                  value: deviceInfo.batteryLevel
                });

                await batteryChar.subscribeAsync();
                this.log('Subscribed to battery updates', peripheral.uuid);
                
                batteryChar.on('data', (data) => {
                  deviceInfo.batteryLevel = data[0];
                  this.updateDeviceInfo(peripheral.uuid, { batteryLevel: data[0] });
                  this.emit('propertyUpdate', {
                    deviceId: peripheral.uuid,
                    property: 'batteryLevel',
                    value: data[0]
                  });
                  this.emit('deviceUpdate', this.devices.get(peripheral.uuid));
                });
              }
            } catch (error) {
              this.log('Error handling battery service', {
                error: error.toString(),
                stack: error.stack
              });
            }
          }

          // Store the complete device info
          this.devices.set(peripheral.uuid, {
            ...deviceInfo,
            peripheral,
            service: cosmoService
          });

          // Emit device connected event
          this.emit('deviceConnected', deviceInfo);
          this.emit('deviceUpdate', deviceInfo);

          // Set up Cosmo service characteristics
          try {
            this.log('Discovering Cosmo service characteristics...', peripheral.uuid);
            const characteristics = await cosmoService.discoverCharacteristicsAsync();
            this.log('Cosmo characteristics discovered', characteristics.map(c => c.uuid));
            
            for (const char of characteristics) {
              if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID || 
                  char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
                try {
                  await char.subscribeAsync();
                  this.log('Subscribed to characteristic', {
                    uuid: char.uuid,
                    device: peripheral.uuid
                  });
                  
                  char.on('data', (data) => {
                    if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID) {
                      const sensorValue = data[0];
                      this.updateDeviceInfo(peripheral.uuid, { sensorValue });
                      this.emit('sensorUpdate', {
                        deviceId: peripheral.uuid,
                        value: sensorValue
                      });
                    } else if (char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
                      const buttonState = data[0];
                      const pressValue = data[1];
                      this.updateDeviceInfo(peripheral.uuid, { 
                        buttonState,
                        pressValue
                      });
                      this.emit('buttonUpdate', {
                        deviceId: peripheral.uuid,
                        buttonState,
                        pressValue
                      });
                      // Also emit property updates for button state and press value
                      this.emit('propertyUpdate', {
                        deviceId: peripheral.uuid,
                        property: 'buttonState',
                        value: buttonState
                      });
                      this.emit('propertyUpdate', {
                        deviceId: peripheral.uuid,
                        property: 'pressValue',
                        value: pressValue
                      });
                    }
                  });
                } catch (subError) {
                  this.log('Error subscribing to characteristic', {
                    uuid: char.uuid,
                    error: subError.toString(),
                    stack: subError.stack
                  });
                }
              }
            }
          } catch (error) {
            this.log('Error discovering Cosmo characteristics', {
              error: error.toString(),
              stack: error.stack
            });
          }

        } catch (error) {
          this.log('Error connecting to device', {
            uuid: peripheral.uuid,
            error: error.toString(),
            stack: error.stack
          });
          
          try {
            await peripheral.disconnectAsync();
          } catch (disconnectError) {
            this.log('Error disconnecting after failure', {
              uuid: peripheral.uuid,
              error: disconnectError.toString()
            });
          }
        }
      }
    });

    // Handle disconnection
    noble.on('disconnect', async (peripheral) => {
      this.log('Device disconnected', peripheral.uuid);
      if (this.devices.has(peripheral.uuid)) {
        const deviceInfo = this.devices.get(peripheral.uuid);
        deviceInfo.connected = false;
        this.emit('deviceDisconnected', {
          id: peripheral.uuid,
          name: deviceInfo.name
        });
        this.emit('deviceUpdate', deviceInfo);
      }
    });
  }

  updateDeviceInfo(deviceId, updates) {
    const device = this.devices.get(deviceId);
    if (device) {
      Object.assign(device, updates);
      this.emit('deviceUpdate', device);
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

  startScanning() {
    if (this._scanning) {
      return;
    }

    this._scanning = true;
    noble.startScanning([], true, (error) => {
      this.log('Scanning started', error);
    });

    // Periodically check device connections
    this._connectionCheckInterval = setInterval(() => {
      for (const [uuid, device] of this.devices.entries()) {
        if (device.peripheral && !device.peripheral.state !== 'connected') {
          this.log('Device connection lost', uuid);
          this.handleDeviceDisconnection(uuid, device);
        }
      }
    }, 5000);
  }

  stopScanning() {
    this._scanning = false;
    if (this._connectionCheckInterval) {
      clearInterval(this._connectionCheckInterval);
    }
    noble.stopScanning((error) => {
      this.log('Stopped scanning', error);
    });
  }

  handleDeviceDisconnection(uuid, device) {
    if (device.connected) {
      device.connected = false;
      this.emit('deviceDisconnected', {
        id: uuid,
        name: device.name
      });
      this.devices.delete(uuid);
      this.emit('deviceUpdate', {
        id: uuid,
        name: device.name,
        connected: false
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