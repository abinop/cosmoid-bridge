const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const noble = require('@abandonware/noble');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    
    // Cosmo device UUIDs
    this.DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
    this.SERIAL_CHARACTERISTIC_UUID = '00002a25-0000-1000-8000-00805f9b34fb';
    this.FIRMWARE_CHARACTERISTIC_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
    this.COSMO_SERVICE_UUID = '00001523-1212-efde-1523-785feabcd123';
    this.SENSOR_CHARACTERISTIC_UUID = '00001524-1212-efde-1523-785feabcd123';
    this.BUTTON_STATUS_CHARACTERISTIC_UUID = '00001525-1212-efde-1523-785feabcd123';
    this.COMMAND_CHARACTERISTIC_UUID = '00001528-1212-efde-1523-785feabcd123';
    
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
        rssi: peripheral.rssi
      });

      if (peripheral.advertisement.localName?.includes('Cosmo')) {
        this.log('Cosmo device found', peripheral.advertisement.localName);
        
        try {
          // Connect to the device
          await peripheral.connectAsync();
          this.log('Connected to device', peripheral.uuid);

          // Discover services
          const services = await peripheral.discoverServicesAsync([this.COSMO_SERVICE_UUID]);
          this.log('Discovered services count', services.length);

          for (const service of services) {
            this.log('Processing service', service.uuid);
            if (service.uuid === this.COSMO_SERVICE_UUID) {
              // Discover characteristics
              const characteristics = await service.discoverCharacteristicsAsync([
                this.SENSOR_CHARACTERISTIC_UUID,
                this.BUTTON_STATUS_CHARACTERISTIC_UUID,
                this.COMMAND_CHARACTERISTIC_UUID
              ]);

              this.log('Discovered characteristics count', characteristics.length);

              // Store device info
              this.devices.set(peripheral.uuid, {
                peripheral,
                service,
                characteristics: characteristics.reduce((acc, char) => {
                  acc[char.uuid] = char;
                  return acc;
                }, {})
              });

              // Subscribe to notifications
              for (const char of characteristics) {
                this.log('Processing characteristic', char.uuid);
                if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID || 
                    char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
                  try {
                    await char.subscribeAsync();
                    this.log('Subscribed to characteristic', char.uuid);
                    
                    char.on('data', (data) => {
                      this.log(`Characteristic ${char.uuid} value changed`, data);
                      if (char.uuid === this.SENSOR_CHARACTERISTIC_UUID) {
                        const sensorValue = data.readUInt8(0);
                        this.log('Sensor value', sensorValue);
                      } else if (char.uuid === this.BUTTON_STATUS_CHARACTERISTIC_UUID) {
                        const buttonState = data.readUInt8(0);
                        const forceValue = data.readUInt8(1);
                        this.log('Button status', { buttonState, forceValue });
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
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
    console.log(logMessage);
    fs.appendFileSync(this.logPath, logMessage);
  }

  startActualScan() {
    noble.startScanningAsync([this.COSMO_SERVICE_UUID], false)
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