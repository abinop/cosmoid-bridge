const EventEmitter = require('events');
const ble = require('./ble');

class BLEServer extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    console.log('BLEServer initialized');
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
    console.log('BLEServer.startScanning called');
    try {
      await ble.startScanning();
      console.log('Scanning started successfully');
    } catch (error) {
      console.error('Error starting scan:', error);
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

