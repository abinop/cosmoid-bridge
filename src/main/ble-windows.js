const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const noble = require('@abandonware/noble');

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
    this.log('BLEManager', 'Initialized');
  }

  setupNoble() {
    noble.on('stateChange', (state) => {
      this.log('Bluetooth state changed', state);
      if (state === 'poweredOn' && this.isScanning) {
        this.startActualScan();
      }
    });

    noble.on('discover', async (peripheral) => {
      this.log('Device found', {
        name: peripheral.advertisement.localName,
        uuid: peripheral.uuid,
        rssi: peripheral.rssi,
        serviceUuids: peripheral.advertisement.serviceUuids
      });

      if (peripheral.advertisement.localName?.includes('Cosmo')) {
        this.log('Cosmo device found', peripheral.advertisement.localName);
        
        try {
          // Connect to the device
          await peripheral.connectAsync();
          this.log('Connected to device', peripheral.uuid);

          // Discover all services first
          const services = await peripheral.discoverServicesAsync();
          this.log('Discovered services', services.map(s => s.uuid));

          // Find our services
          const cosmoService = services.find(s => s.uuid === this.COSMO_SERVICE_UUID);
          const deviceInfoService = services.find(s => s.uuid === '180a');
          const batteryService = services.find(s => s.uuid === '180f');

          if (!cosmoService) {
            throw new Error(`Cosmo service not found. Available services: ${services.map(s => s.uuid).join(', ')}`);
          }

          // Read device information
          let deviceInfo = {
            id: peripheral.uuid,
            name: peripheral.advertisement.localName,
            serial: null,
            firmware: null,
            batteryLevel: null
          };

          if (deviceInfoService) {
            try {
              const characteristics = await deviceInfoService.discoverCharacteristicsAsync();
              this.log('Device Info characteristics', characteristics.map(c => c.uuid));
              
              for (const char of characteristics) {
                try {
                  if (char.uuid === '2a25') { // Serial Number
                    const data = await char.readAsync();
                    deviceInfo.serial = data.toString().trim();
                    this.log('Serial Number', deviceInfo.serial);
                  } else if (char.uuid === '2a26') { // Firmware
                    const data = await char.readAsync();
                    deviceInfo.firmware = data.toString().trim();
                    this.log('Firmware Version', deviceInfo.firmware);
                  }
                } catch (charError) {
                  this.log('Error reading characteristic', {
                    uuid: char.uuid,
                    error: charError.toString()
                  });
                }
              }
            } catch (error) {
              this.log('Error reading device info service', error);
            }
          }

          if (batteryService) {
            try {
              const characteristics = await batteryService.discoverCharacteristicsAsync();
              const batteryChar = characteristics.find(c => c.uuid === '2a19');
              if (batteryChar) {
                const data = await batteryChar.readAsync();
                deviceInfo.batteryLevel = data[0];
                this.log('Battery Level', deviceInfo.batteryLevel);

                // Subscribe to battery updates
                await batteryChar.subscribeAsync();
                batteryChar.on('data', (data) => {
                  deviceInfo.batteryLevel = data[0];
                  this.emit('batteryUpdate', {
                    deviceId: peripheral.uuid,
                    level: data[0]
                  });
                });
              }
            } catch (error) {
              this.log('Error reading battery service', error);
            }
          }

          this.log('Device Info', deviceInfo);
          
          // Emit initial device info
          this.emit('deviceInfo', deviceInfo);

          // Discover all characteristics
          const characteristics = await cosmoService.discoverCharacteristicsAsync();
          this.log('Discovered characteristics', characteristics.map(c => c.uuid));

          // Store device info
          const deviceData = {
            peripheral,
            service: cosmoService,
            characteristics: characteristics.reduce((acc, char) => {
              acc[char.uuid] = char;
              return acc;
            }, {}),
            info: deviceInfo
          };
          this.devices.set(peripheral.uuid, deviceData);

          // Subscribe to notifications for each relevant characteristic
          for (const char of characteristics) {
            this.log('Processing characteristic', char.uuid);
            
            if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID || 
                char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
              try {
                // Read the initial value
                const value = await char.readAsync();
                this.log(`Initial value for ${char.uuid}`, value);

                // Subscribe to notifications
                await char.subscribeAsync();
                this.log('Subscribed to characteristic', char.uuid);
                
                char.on('data', (data) => {
                  this.log(`Characteristic ${char.uuid} value changed`, data);
                  if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID) {
                    const sensorValue = data.readUInt8(0);
                    this.log('Sensor value', sensorValue);
                    this.emit('sensorUpdate', {
                      deviceId: peripheral.uuid,
                      value: sensorValue
                    });
                  } else if (char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
                    const buttonState = data.readUInt8(0);
                    const forceValue = data.readUInt8(1);
                    this.log('Button status', { buttonState, forceValue });
                    this.emit('buttonUpdate', {
                      deviceId: peripheral.uuid,
                      buttonState,
                      forceValue
                    });
                  }
                });
              } catch (subError) {
                this.log('Error handling characteristic', {
                  uuid: char.uuid,
                  error: subError.toString(),
                  stack: subError.stack
                });
              }
            }
          }

          // Emit device connected event
          this.emit('deviceConnected', {
            id: peripheral.uuid,
            name: peripheral.advertisement.localName
          });

        } catch (error) {
          this.log('Error connecting to device', {
            error: error.toString(),
            stack: error.stack
          });
        }
      }
    });
  }

  emit(event, data) {
    // You can implement your event emitting logic here
    this.log('Event emitted', { event, data });
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
    console.log(logMessage);
    fs.appendFileSync(this.logPath, logMessage);
  }

  startActualScan() {
    noble.startScanningAsync([], false) // Scan for all devices, filter by name instead
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
      const commandChar = deviceInfo.characteristics[this.COMMAND_CHARACTERISTIC_UUID];
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
      const commandChar = deviceInfo.characteristics[this.COMMAND_CHARACTERISTIC_UUID];
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