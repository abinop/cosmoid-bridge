const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

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

    this.log('BLEManager', 'Initialized');
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
    console.log(logMessage);
    fs.appendFileSync(this.logPath, logMessage);
  }

  async startScanning() {
    if (this.isScanning) {
      this.log('startScanning', 'Already scanning');
      return;
    }

    this.isScanning = true;
    this.devices.clear();

    try {
      // Request Bluetooth device with Cosmo service UUID
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'Cosmo' },
          { services: [this.COSMO_SERVICE_UUID] }
        ],
        optionalServices: [
          this.DEVICE_INFO_SERVICE_UUID,
          '0000180f-0000-1000-8000-00805f9b34fb' // Battery Service
        ]
      });

      this.log('Device found', device.name);
      
      // Connect to the device
      const server = await device.gatt.connect();
      this.log('Connected to GATT server', server);

      // Get Cosmo service
      const cosmoService = await server.getPrimaryService(this.COSMO_SERVICE_UUID);
      this.log('Got Cosmo service', cosmoService);

      // Get and subscribe to sensor characteristic
      const sensorChar = await cosmoService.getCharacteristic(this.SENSOR_CHARACTERISTIC_UUID);
      await sensorChar.startNotifications();
      sensorChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        const sensorValue = value.getUint8(0);
        this.log('Sensor value changed', sensorValue);
        // Emit event or callback here
      });

      // Get and subscribe to button status
      const buttonChar = await cosmoService.getCharacteristic(this.BUTTON_STATUS_CHARACTERISTIC_UUID);
      await buttonChar.startNotifications();
      buttonChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        const buttonState = value.getUint8(0);
        const forceValue = value.getUint8(1);
        this.log('Button status changed', { buttonState, forceValue });
        // Emit event or callback here
      });

      // Store device info
      this.devices.set(device.id, {
        device,
        server,
        service: cosmoService,
        sensorChar,
        buttonChar
      });

    } catch (error) {
      this.log('Error scanning', error);
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  async stopScanning() {
    this.isScanning = false;
    // Web Bluetooth API handles cleanup automatically
    this.log('Stopped scanning', null);
  }

  async setColor(deviceId, r, g, b, mode = 1) {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error('Device not found');
    }

    try {
      const commandChar = await deviceInfo.service.getCharacteristic(this.COMMAND_CHARACTERISTIC_UUID);
      const command = new Uint8Array([2, r, g, b, mode]); // 2 is SET_COLOR command
      await commandChar.writeValue(command);
      this.log('Color set', { r, g, b, mode });
    } catch (error) {
      this.log('Error setting color', error);
      throw error;
    }
  }

  async setBrightness(deviceId, intensity, delay = 1) {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error('Device not found');
    }

    try {
      const commandChar = await deviceInfo.service.getCharacteristic(this.COMMAND_CHARACTERISTIC_UUID);
      const command = new Uint8Array([1, intensity, delay]); // 1 is SET_LUMINOSITY command
      await commandChar.writeValue(command);
      this.log('Brightness set', { intensity, delay });
    } catch (error) {
      this.log('Error setting brightness', error);
      throw error;
    }
  }
}

module.exports = new BLEManager();