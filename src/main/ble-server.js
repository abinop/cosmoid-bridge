// BLE server implementation for device management
const noble = require('@abandonware/noble');
const EventEmitter = require('events');

// Define the service UUIDs without hyphens to match the device format
const SERVICE_UUID = '000015231212efde1523785feabcd123';
const BATTERY_SERVICE_UUID = '180F';
const DEVICE_INFO_SERVICE = '180a';
const DEVICE_SERIAL_NUMBER = '2a25';
const DEVICE_FIRMWARE_VERSION = '2a26';
const DEVICE_HARDWARE_VERSION = '2a27';
const DEVICE_BATTERY_LEVEL = '2a19';
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

  // Add method to get all devices
  getAllDevices() {
    // Convert the Map values to an array
    return Array.from(this.discoveredDevices.values()).map(device => ({
      id: device.info.id,
      name: device.info.name,
      connected: this.connectedDevices.has(device.info.id),
      serialNumber: device.info.serialNumber || 'Unknown',
      batteryLevel: device.info.batteryLevel || null
    }));
  }

  // Add method to read battery level
  async readBatteryLevel(deviceId) {
    const device = this.discoveredDevices.get(deviceId);
    if (!device) return null;

    try {
      // Try to read battery characteristic if it exists
      const batteryChar = device.characteristics?.get('BATTERY_LEVEL');
      if (batteryChar) {
        const value = await batteryChar.readAsync();
        device.info.batteryLevel = value[0];
        this.emit('deviceUpdated', this.getAllDevices());
        return value[0];
      }
      return null;
    } catch (error) {
      console.error('Failed to read battery level:', error);
      return null;
    }
  }

  async connectToDevice(deviceId) {
    const device = this.discoveredDevices.get(deviceId);
    
    if (device) {
      try {
        console.log('Attempting to connect to Cosmo device:', device.info.name);
        await device.peripheral.connectAsync();
        console.log('Connected successfully to:', device.info.name);

        this.connectedDevices.set(deviceId, device);
        console.log('Discovering services and characteristics...');
        
        // Discover all services
        const services = await device.peripheral.discoverServicesAsync();
        console.log('Discovered services:', services.map(s => s.uuid));

        device.characteristics = new Map();

        // Process each service
        for (const service of services) {
          console.log('Processing service:', service.uuid);
          // Discover all characteristics for each service
          const characteristics = await service.discoverCharacteristicsAsync();
          
          for (const characteristic of characteristics) {
            console.log('Found characteristic:', characteristic.uuid);
            
            // Store all characteristics
            device.characteristics.set(characteristic.uuid, characteristic);

            try {
              switch(characteristic.uuid) {
                case CHARACTERISTICS.SENSOR:
                case CHARACTERISTICS.BUTTON_STATUS:
                  console.log('Setting up notifications for:', characteristic.uuid);
                  await characteristic.subscribeAsync();
                  characteristic.on('data', (data) => {
                    this.handleCharacteristicData(deviceId, characteristic.uuid, data);
                  });
                  break;

                case DEVICE_SERIAL_NUMBER:
                  console.log('Reading serial number');
                  const serialData = await characteristic.readAsync();
                  device.info.serialNumber = serialData.toString().trim();
                  console.log('Serial Number:', device.info.serialNumber);
                  break;

                case DEVICE_FIRMWARE_VERSION:
                  console.log('Reading firmware version');
                  const fwData = await characteristic.readAsync();
                  device.info.firmwareVersion = fwData.toString().trim();
                  console.log('Firmware Version:', device.info.firmwareVersion);
                  break;

                case DEVICE_HARDWARE_VERSION:
                  console.log('Reading hardware version');
                  const hwData = await characteristic.readAsync();
                  device.info.hardwareVersion = hwData.toString().trim();
                  console.log('Hardware Version:', device.info.hardwareVersion);
                  break;

                case DEVICE_BATTERY_LEVEL:
                  console.log('Reading battery level');
                  const batteryData = await characteristic.readAsync();
                  device.info.batteryLevel = batteryData[0];
                  console.log('Battery Level:', device.info.batteryLevel);
                  
                  // Set up battery notifications if supported
                  await characteristic.subscribeAsync();
                  characteristic.on('data', (data) => {
                    device.info.batteryLevel = data[0];
                    console.log('Battery Level Updated:', device.info.batteryLevel);
                    this.emit('deviceUpdated', this.getAllDevices());
                  });
                  break;
              }
            } catch (error) {
              console.error(`Error handling characteristic ${characteristic.uuid}:`, error);
            }
          }
        }

        this.emit('deviceConnected', {
          id: deviceId,
          name: device.info.name,
          connected: true,
          batteryLevel: device.info.batteryLevel,
          serialNumber: device.info.serialNumber,
          firmwareVersion: device.info.firmwareVersion,
          hardwareVersion: device.info.hardwareVersion
        });

        return true;
      } catch (error) {
        console.error('Failed to connect:', error);
        return false;
      }
    }
    return false;
  }

  handleCharacteristicData(deviceId, characteristicUuid, data) {
    const device = this.discoveredDevices.get(deviceId);
    if (!device) return;

    switch(characteristicUuid) {
      case CHARACTERISTICS.SENSOR:
        device.info.sensorValue = data[0];
        break;

      case DEVICE_SERIAL_NUMBER:
        device.info.serialNumber = data.toString().trim();
        console.log('Serial Number:', device.info.serialNumber);
        break;

      case DEVICE_FIRMWARE_VERSION:
        device.info.firmwareVersion = data.toString().trim();
        console.log('Firmware Version:', device.info.firmwareVersion);
        break;

      case DEVICE_HARDWARE_VERSION:
        device.info.hardwareVersion = data.toString().trim();
        console.log('Hardware Version:', device.info.hardwareVersion);
        break;

      case DEVICE_BATTERY_LEVEL:
        device.info.batteryLevel = data[0];
        console.log('Battery Level:', device.info.batteryLevel);
        break;

      case CHARACTERISTICS.BUTTON_STATUS:
        const buttonValue = data[0];
        if (buttonValue === 0) {
          this.emit('buttonPressed', { deviceId, value: buttonValue });
        } else {
          this.emit('buttonReleased', { deviceId });
        }
        break;
    }

    this.emit('deviceUpdated', this.getAllDevices());
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
    if (!device) {
      console.error('Device not found:', deviceId);
      return false;
    }
    
    if (!device.characteristics) {
      console.error('No characteristics available for device:', deviceId);
      return false;
    }

    try {
      // Get command characteristic by UUID
      const commandChar = device.characteristics.get(CHARACTERISTICS.COMMAND);
      console.log('Command characteristic:', commandChar?.uuid);
      
      if (!commandChar) {
        console.error('Command characteristic not found');
        console.log('Available characteristics:', Array.from(device.characteristics.keys()));
        return false;
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

