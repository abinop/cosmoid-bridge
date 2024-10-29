// BLE server implementation for device management
const noble = require('@abandonware/noble');
const EventEmitter = require('events');

// Define the service UUIDs without hyphens to match the device format
const SERVICE_UUID = '000015231212efde1523785feabcd123';
const CHARACTERISTICS = {
  SENSOR: '000015241212efde1523785feabcd123',
  BUTTON_STATUS: '000015251212efde1523785feabcd123',
  COMMAND: '000015281212efde1523785feabcd123'
};

// Command definitions
const COMMANDS = {
  SET_LUMINOSITY: 1,  // [1, intensity, delay]
  SET_COLOR: 2        // [2, r, g, b, 1]
};

class BLEServer extends EventEmitter {
  constructor() {
    super();
    this.discoveredDevices = new Map(); // Track all discovered devices
    this.connectedDevices = new Map();
    this.setupNoble();
  }

  setupNoble() {
    noble.on('stateChange', (state) => {
      console.log('Bluetooth state:', state);
      if (state === 'poweredOn') {
        this.startScanning();
      } else {
        console.log('Bluetooth state is not powered on:', state);
        // If Bluetooth is turned off, clear all devices
        this.discoveredDevices.clear();
        this.connectedDevices.clear();
      }
    });

    noble.on('discover', (peripheral) => {
      this.handleDiscoveredDevice(peripheral);
    });

    // Add scanning started event handler
    noble.on('scanStart', () => {
      console.log('Scanning started for Cosmo devices...');
    });

    // Add scanning stopped event handler
    noble.on('scanStop', () => {
      console.log('Scanning stopped...');
    });

    // Add state change handler for device disconnection
    noble.on('disconnect', (peripheral) => {
      console.log('Device disconnected:', peripheral.id);
      this.handleDeviceDisconnect(peripheral.id);
    });
  }

  startScanning() {
    console.log('Starting BLE scan for Cosmo devices...');
    // First stop any existing scan
    noble.stopScanning(() => {
      // Start scanning only for Cosmo service UUID
      noble.startScanning([SERVICE_UUID], true, (error) => {
        if (error) {
          console.error('Failed to start scanning:', error);
        }
      });
    });
  }

  handleDiscoveredDevice(peripheral) {
    // Only handle if not already discovered
    if (!this.discoveredDevices.has(peripheral.id)) {
      console.log('Discovered Cosmo device:', peripheral.advertisement.localName || 'Unknown', peripheral.id);
      
      const deviceInfo = {
        id: peripheral.id,
        name: peripheral.advertisement.localName || 'Unknown Device',
        connected: false
      };

      this.discoveredDevices.set(peripheral.id, { peripheral, info: deviceInfo });
      
      // Set max listeners to prevent memory leak warning
      peripheral.setMaxListeners(2);
      
      peripheral.on('connect', () => {
        deviceInfo.connected = true;
        this.connectedDevices.set(peripheral.id, { peripheral, info: deviceInfo });
        this.emit('deviceConnected', deviceInfo);
      });

      peripheral.on('disconnect', () => {
        console.log('Device disconnected:', deviceInfo.name);
        this.handleDeviceDisconnect(peripheral.id);
      });

      // Emit device discovered event
      this.emit('deviceDiscovered', deviceInfo);
    } else {
      // Update RSSI for existing device
      const device = this.discoveredDevices.get(peripheral.id);
      device.info.rssi = peripheral.rssi;
      this.emit('deviceUpdated', device.info);
    }
  }

  handleDeviceDisconnect(deviceId) {
    const device = this.discoveredDevices.get(deviceId);
    if (device) {
      console.log('Processing disconnect for device:', device.info.name);
      device.info.connected = false;
      this.connectedDevices.delete(deviceId);
      this.discoveredDevices.delete(deviceId);
      
      // Clean up any existing listeners
      try {
        device.characteristics?.forEach(char => char.removeAllListeners());
      } catch (error) {
        console.warn('Error cleaning up characteristic listeners:', error);
      }

      this.emit('deviceDisconnected', device.info);
      
      // Restart scanning to rediscover the device if it comes back
      this.startScanning();
    }
  }

  // Add method to get all discovered devices
  getAllDevices() {
    return Array.from(this.discoveredDevices.values()).map(d => d.info);
  }

  async connectToDevice(deviceId) {
    const device = this.discoveredDevices.get(deviceId);
    
    if (device) {
      try {
        console.log('Attempting to connect to Cosmo device:', device.info.name);
        await device.peripheral.connectAsync();
        console.log('Connected successfully to:', device.info.name);

        console.log('Discovering services and characteristics...');
        
        // Format the service UUID correctly
        console.log('Using service UUID:', SERVICE_UUID);

        // First discover services
        const services = await device.peripheral.discoverServicesAsync([SERVICE_UUID]);
        console.log('Discovered services:', services);

        if (!services || services.length === 0) {
          throw new Error('No matching services found');
        }

        // Then discover characteristics for the first matching service
        const service = services[0];
        const characteristicUUIDs = [
          CHARACTERISTICS.SENSOR,
          CHARACTERISTICS.BUTTON_STATUS,
          CHARACTERISTICS.COMMAND
        ];
        
        console.log('Looking for characteristics:', characteristicUUIDs);
        
        // Discover characteristics
        const characteristics = await service.discoverCharacteristicsAsync(characteristicUUIDs);
        console.log('Found characteristics:', characteristics);
        
        if (!characteristics || characteristics.length === 0) {
          throw new Error('No characteristics found');
        }

        // Store characteristics in both device objects
        device.characteristics = characteristics;
        if (this.connectedDevices.has(deviceId)) {
          this.connectedDevices.get(deviceId).characteristics = characteristics;
        }
        
        // Setup notifications for each characteristic
        for (const char of characteristics) {
          try {
            console.log('Setting up notifications for characteristic:', char.uuid);
            await char.subscribeAsync();
            char.on('data', (data) => {
              // console.log('Received data from characteristic:', char.uuid, data);
              this.emit('characteristicChanged', {
                deviceId,
                characteristicUUID: char.uuid,
                value: Array.from(data)
              });
            });
          } catch (notifyError) {
            console.warn('Failed to setup notifications for characteristic:', char.uuid, notifyError);
          }
        }

        // Update connection status
        device.info.connected = true;
        this.connectedDevices.set(deviceId, device);
        this.emit('deviceConnected', device.info);
        
        return true;
      } catch (error) {
        console.error('Failed to connect:', error);
        this.handleDeviceDisconnect(deviceId);
        return false;
      }
    } else {
      console.error('Device not found:', deviceId);
      return false;
    }
  }

  async writeCharacteristic(deviceId, characteristicUUID, value) {
    const device = this.connectedDevices.get(deviceId);
    if (device && device.characteristics) {
      const characteristic = device.characteristics
        .find(c => c.uuid === SERVICE_UUID);
      
      if (characteristic) {
        await characteristic.writeAsync(Buffer.from(value), false);
        return true;
      }
    }
    return false;
  }

  // Add method to send events to device
  async sendEventToDevice(deviceId, eventType, data) {
    const device = this.connectedDevices.get(deviceId);
    if (!device || !device.characteristics) {
      console.error('Device not found or no characteristics available:', deviceId);
      return false;
    }

    try {
      // Find command characteristic by direct array access since we know it's the third one
      const commandChar = device.characteristics[2];
      
      // Verify it's the correct characteristic (without hyphens)
      if (commandChar.uuid !== CHARACTERISTICS.COMMAND) {
        console.error('Unexpected characteristic UUID:', commandChar.uuid);
        console.error('Expected:', CHARACTERISTICS.COMMAND);
        throw new Error('Command characteristic mismatch');
      }

      let command;
      switch (eventType) {
        case 'setLuminosity':
          command = Buffer.from([
            COMMANDS.SET_LUMINOSITY, 
            data[0],  // intensity
            1        // default delay
          ]);
          console.log('Sending luminosity command:', command);
          break;

        case 'setColor':
          command = Buffer.from([
            COMMANDS.SET_COLOR,
            data[0],  // r
            data[1],  // g
            data[2],  // b
            1        // mode (always 1 in the example)
          ]);
          console.log('Sending color command:', command);
          break;

        default:
          throw new Error('Unknown command type: ' + eventType);
      }

      console.log('Writing command to characteristic:', command);
      await commandChar.writeAsync(command, false);
      console.log('Command written successfully');
      return true;
    } catch (error) {
      console.error('Failed to send command to device:', error);
      return false;
    }
  }

  formatEventForDevice(eventType, data) {
    // Format based on device protocol
    // Example format: [eventType, ...data]
    return [eventType, ...(Array.isArray(data) ? data : [data])];
  }

  // Add periodic connection check
  startConnectionCheck() {
    setInterval(() => {
      this.checkConnections();
    }, 2000); // Check every 2 seconds
  }

  async checkConnections() {
    for (const [deviceId, device] of this.connectedDevices) {
      try {
        // Check if the device is still connected
        const state = await device.peripheral.stateAsync();
        if (state !== 'connected') {
          console.log('Device lost connection:', device.info.name);
          this.handleDeviceDisconnect(deviceId);
        }
      } catch (error) {
        console.log('Error checking connection, assuming disconnected:', device.info.name);
        this.handleDeviceDisconnect(deviceId);
      }
    }
  }
}

module.exports = { BLEServer };

