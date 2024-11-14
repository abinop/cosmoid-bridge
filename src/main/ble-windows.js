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
    
    // Load Windows Bluetooth API
    this.bluetooth = ffi.Library('Bthprops.cpl', {
      'BluetoothFindFirstDevice': ['pointer', []],
      'BluetoothFindNextDevice': ['bool', ['pointer', BLUETOOTH_DEVICE_INFO]],
      'BluetoothFindDeviceClose': ['bool', ['pointer']]
    });
  }

  async initialize() {
    try {
      // Check if we can access the Bluetooth API
      if (!this.bluetooth) {
        throw new Error('Failed to load Bluetooth API');
      }
      return this;
    } catch (error) {
      console.error('Failed to initialize BLE:', error);
      throw error;
    }
  }

  async startScanning() {
    if (!this.isScanning) {
      this.isScanning = true;
      try {
        const deviceInfo = new BLUETOOTH_DEVICE_INFO();
        deviceInfo.dwSize = BLUETOOTH_DEVICE_INFO.size;

        const handle = this.bluetooth.BluetoothFindFirstDevice();
        if (handle.isNull()) {
          return;
        }

        do {
          const device = {
            name: deviceInfo.szName,
            address: deviceInfo.address.toString(16),
            connected: deviceInfo.fConnected,
            remembered: deviceInfo.fRemembered,
            authenticated: deviceInfo.fAuthenticated
          };
          
          this.devices.set(device.address, device);
        } while (this.bluetooth.BluetoothFindNextDevice(handle, deviceInfo));

        this.bluetooth.BluetoothFindDeviceClose(handle);
      } catch (error) {
        console.error('Scanning error:', error);
        throw error;
      }
    }
  }

  async stopScanning() {
    this.isScanning = false;
  }

  async getDevices() {
    return Array.from(this.devices.values());
  }
}

module.exports = new BLEManager(); 