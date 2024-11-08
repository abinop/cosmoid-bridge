// BLE server implementation for device management
const noble = require('@abandonware/noble');
const EventEmitter = require('events');
const { 
  BLE_SERVICE_UUID,
  BLE_BATTERY_SERVICE_UUID,
  BLE_DEVICE_INFO_SERVICE,
  BLE_CHARACTERISTICS 
} = require('../common/constants');

// Command definitions
const COMMANDS = {
  SET_LUMINOSITY: 1,  // [1, intensity, delay]
  SET_COLOR: 2        // [2, r, g, b, 1]
};

function normalizeUUID(uuid) {
    return uuid.toLowerCase().replace(/-/g, '');
}

class BLEServer extends EventEmitter {
  constructor() {
    super();
    console.log('🔍 BLE Characteristics we are looking for:', {
      SENSOR: BLE_CHARACTERISTICS.SENSOR,
      BUTTON_STATUS: BLE_CHARACTERISTICS.BUTTON_STATUS,
      BATTERY_LEVEL: BLE_CHARACTERISTICS.BATTERY_LEVEL,
      SERVICE: BLE_SERVICE_UUID
    });
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
      noble.startScanning([BLE_SERVICE_UUID], true, (error) => {
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
      const batteryChar = device.characteristics?.get(BLE_CHARACTERISTICS.BATTERY_LEVEL);
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
        // console.log('Attempting to connect to Cosmo device:', device.info.name);
        await device.peripheral.connectAsync();
        // console.log('Connected successfully to:', device.info.name);

        this.connectedDevices.set(deviceId, device);
        // console.log('Discovering services and characteristics...');
        
        // Discover all services
        const services = await device.peripheral.discoverServicesAsync();
        // console.log('🔍 Discovered services:', services.map(s => s.uuid));

        device.characteristics = new Map();

        // Process each service
        for (const service of services) {
          // console.log('🔍 Processing service:', service.uuid);
          // Discover all characteristics for each service
          const characteristics = await service.discoverCharacteristicsAsync();
          // console.log('🔍 Found characteristics for service:', characteristics.map(c => c.uuid));
          
          for (const characteristic of characteristics) {
            const normalizedCharUUID = normalizeUUID(characteristic.uuid);
            // console.log('Processing characteristic:', {
            //     uuid: characteristic.uuid,
            //     isCommand: normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.COMMAND)
            // });
            
            // Store characteristic with both formats of UUID
            device.characteristics.set(characteristic.uuid, characteristic);
            if (characteristic.uuid.includes('-')) {
                // Also store without dashes for normalized lookup
                device.characteristics.set(characteristic.uuid.replace(/-/g, ''), characteristic);
            } else {
                // Also store with dashes for original format lookup
                const uuidWithDashes = characteristic.uuid.replace(
                    /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i,
                    '$1-$2-$3-$4-$5'
                );
                device.characteristics.set(uuidWithDashes, characteristic);
            }

            try {
                if (normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.SENSOR)) {
                    await characteristic.subscribeAsync();
                    characteristic.on('data', (data) => {
                        this.handleCharacteristicData(deviceId, BLE_CHARACTERISTICS.SENSOR, data);
                    });
                }
                else if (normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.BUTTON_STATUS)) {
                    await characteristic.subscribeAsync();
                    characteristic.on('data', (data) => {
                        this.handleCharacteristicData(deviceId, BLE_CHARACTERISTICS.BUTTON_STATUS, data);
                    });
                }
                else if (normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.BATTERY_LEVEL)) {
                    const batteryData = await characteristic.readAsync();
                    device.info.batteryLevel = batteryData[0];
                    await characteristic.subscribeAsync();
                    characteristic.on('data', (data) => {
                        this.handleCharacteristicData(deviceId, BLE_CHARACTERISTICS.BATTERY_LEVEL, data);
                    });
                }
                else if (normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.SERIAL_NUMBER)) {
                    const serialData = await characteristic.readAsync();
                    device.info.serialNumber = serialData.toString().trim();
                }
            } catch (error) {
                console.error('Error setting up characteristic:', characteristic.uuid, error.message);
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
      case BLE_CHARACTERISTICS.SENSOR:
        device.info.sensorValue = data[0];
        
        this.emit('characteristicChanged', {
          deviceId,
          characteristicUUID: normalizeUUID(characteristicUuid),
          value: Array.from(data)
        });
        break;

      case BLE_CHARACTERISTICS.BUTTON_STATUS:
        const buttonValue = data[0];
        const forceValue = data[1] || 0;
        
        device.info.forceValue = forceValue;
        
        this.emit('buttonEvent', {
          deviceId,
          state: buttonValue === 0 ? 'pressed' : 'released',
          force: forceValue
        });

        this.emit('characteristicChanged', {
          deviceId,
          characteristicUUID: normalizeUUID(characteristicUuid),
          value: Array.from(data)
        });
        break;

      case BLE_CHARACTERISTICS.BATTERY_LEVEL:
        device.info.batteryLevel = data[0];
        console.log('Battery:', data[0] + '%');
        
        this.emit('characteristicChanged', {
          deviceId,
          characteristicUUID: normalizeUUID(characteristicUuid),
          value: [data[0]]
        });
        break;
    }

    this.emit('deviceUpdated', {
      devices: this.getAllDevices(),
      deviceInfo: {
        [deviceId]: {
          serialNumber: device.info.serialNumber,
          hardwareRevision: device.info.hardwareVersion,
          firmwareRevision: device.info.firmwareVersion,
          forceValue: device.info.forceValue
        }
      }
    });
  }

  async writeCharacteristic(deviceId, characteristicUUID, value) {
    const device = this.connectedDevices.get(deviceId);
    if (!device || !device.characteristics) {
        console.error('Device not found or no characteristics:', deviceId);
        return false;
    }

    const characteristic = device.characteristics.get(characteristicUUID);
    if (!characteristic) {
        console.error('Characteristic not found:', characteristicUUID);
        return false;
    }

    try {
        await characteristic.writeAsync(Buffer.from(value), false);
        return true;
    } catch (error) {
        console.error('Failed to write characteristic:', error);
        return false;
    }
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
        // Try to find command characteristic with different UUID formats
        const commandUUID = BLE_CHARACTERISTICS.COMMAND;
        const normalizedCommandUUID = normalizeUUID(commandUUID);
        
        let commandChar = device.characteristics.get(commandUUID) || 
                         device.characteristics.get(normalizedCommandUUID);

        if (!commandChar) {
            console.error('Command characteristic not found:', {
                looking_for: [commandUUID, normalizedCommandUUID],
                available: Array.from(device.characteristics.keys())
            });
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
                console.log('Sending luminosity command:', Array.from(command));
                break;

            case 'setColor':
                command = Buffer.from([
                    COMMANDS.SET_COLOR,
                    data[0],  // r
                    data[1],  // g
                    data[2],  // b
                    1        // mode
                ]);
                console.log('Sending color command:', Array.from(command));
                break;

            default:
                throw new Error('Unknown command type: ' + eventType);
        }

        await commandChar.writeAsync(command, false);
        console.log('Command sent successfully');
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

