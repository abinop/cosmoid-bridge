const EventEmitter = require('events');
const ble = require('./ble');

class BLEServer extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.isScanning = false;
  }

  async initialize() {
    try {
      await ble.initialize();
      this.emit('ready');
    } catch (error) {
      console.error('Failed to initialize BLE server:', error);
      this.emit('error', error);
    }
  }

  async startScanning() {
    if (this.isScanning) return;
    
    try {
      this.isScanning = true;
      await ble.startScanning();
      
      // Get devices periodically while scanning
      this.scanInterval = setInterval(async () => {
        const devices = await ble.getDevices();
        devices.forEach(device => {
          if (!this.devices.has(device.id)) {
            this.devices.set(device.id, device);
            this.emit('deviceFound', device);
          }
        });
      }, 1000);

    } catch (error) {
      console.error('Scanning error:', error);
      this.emit('error', error);
    }
  }

  async stopScanning() {
    if (!this.isScanning) return;
    
    try {
      this.isScanning = false;
      if (this.scanInterval) {
        clearInterval(this.scanInterval);
        this.scanInterval = null;
      }
      await ble.stopScanning();
    } catch (error) {
      console.error('Error stopping scan:', error);
      this.emit('error', error);
    }
  }

  async getDevices() {
    try {
      return await ble.getDevices();
    } catch (error) {
      console.error('Error getting devices:', error);
      this.emit('error', error);
      return [];
    }
  }

  async isBluetoothAvailable() {
    try {
      return await ble.isBluetoothAvailable();
    } catch (error) {
      console.error('Error checking Bluetooth availability:', error);
      return false;
    }
  }

  // Handle cleanup
  destroy() {
    this.stopScanning();
    this.removeAllListeners();
    this.devices.clear();
  }
}

module.exports = BLEServer;

