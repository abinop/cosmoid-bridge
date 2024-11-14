const ffi = require('ffi-napi');
const ref = require('ref-napi');
const Struct = require('ref-struct-napi');

// Define Windows Bluetooth LE structures
const BLUETOOTH_DEVICE_INFO = Struct({
  dwSize: 'uint32',
  address: 'uint64',
  ulClassofDevice: 'uint32',
  fConnected: 'bool',
  fRemembered: 'bool',
  fAuthenticated: 'bool',
  szName: ref.types.CString
});

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    this.bluetooth = null;
    
    try {
      // Load Windows Bluetooth API
      this.bluetooth = ffi.Library('Bthprops.cpl', {
        'BluetoothFindFirstDevice': ['pointer', []],
        'BluetoothFindNextDevice': ['bool', ['pointer', ref.refType(BLUETOOTH_DEVICE_INFO)]],
        'BluetoothFindDeviceClose': ['bool', ['pointer']]
      });
    } catch (error) {
      console.error('Failed to load Bluetooth API:', error);
      // Don't throw here, let the initialize method handle the error state
    }
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        // Check if we can access the Bluetooth API
        if (!this.bluetooth) {
          console.error('Bluetooth API not available');
          return reject(new Error('Bluetooth API not available'));
        }

        // Try a simple API call to test the connection
        const handle = this.bluetooth.BluetoothFindFirstDevice();
        if (handle) {
          this.bluetooth.BluetoothFindDeviceClose(handle);
        }

        resolve(this);
      } catch (error) {
        console.error('Failed to initialize BLE:', error);
        reject(error);
      }
    });
  }

  async startScanning() {
    if (this.isScanning || !this.bluetooth) {
      return;
    }

    this.isScanning = true;
    try {
      const deviceInfo = new BLUETOOTH_DEVICE_INFO();
      deviceInfo.dwSize = BLUETOOTH_DEVICE_INFO.size;

      const handle = this.bluetooth.BluetoothFindFirstDevice();
      if (!handle || handle.isNull()) {
        this.isScanning = false;
        return;
      }

      try {
        do {
          if (deviceInfo && deviceInfo.szName) {
            const device = {
              name: deviceInfo.szName,
              address: deviceInfo.address ? deviceInfo.address.toString(16) : 'unknown',
              connected: !!deviceInfo.fConnected,
              remembered: !!deviceInfo.fRemembered,
              authenticated: !!deviceInfo.fAuthenticated
            };
            
            this.devices.set(device.address, device);
          }
        } while (this.bluetooth.BluetoothFindNextDevice(handle, deviceInfo));
      } finally {
        // Always close the handle
        this.bluetooth.BluetoothFindDeviceClose(handle);
      }
    } catch (error) {
      console.error('Scanning error:', error);
      this.isScanning = false;
      throw error;
    }
    
    this.isScanning = false;
  }

  async stopScanning() {
    this.isScanning = false;
  }

  async getDevices() {
    return Array.from(this.devices.values());
  }

  // Helper method to check if Bluetooth is available
  async isBluetoothAvailable() {
    try {
      return !!this.bluetooth;
    } catch (error) {
      console.error('Error checking Bluetooth availability:', error);
      return false;
    }
  }
}

// Create a singleton instance with error handling
let bleManager = null;
try {
  bleManager = new BLEManager();
} catch (error) {
  console.error('Failed to create BLE Manager:', error);
  // Return a dummy manager that reports Bluetooth as unavailable
  bleManager = {
    initialize: async () => { throw new Error('BLE not available'); },
    startScanning: async () => [],
    stopScanning: async () => {},
    getDevices: async () => [],
    isBluetoothAvailable: async () => false
  };
}

module.exports = bleManager; 