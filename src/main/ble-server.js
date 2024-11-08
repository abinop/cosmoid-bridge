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
    this.isScanning = false;
    this.seenDevices = new Set(); // Track devices we've already logged
    console.log('🔍 BLE Characteristics we are looking for:', {
      SENSOR: BLE_CHARACTERISTICS.SENSOR,
      BUTTON_STATUS: BLE_CHARACTERISTICS.BUTTON_STATUS,
      BATTERY_LEVEL: BLE_CHARACTERISTICS.BATTERY_LEVEL,
      SERVICE: BLE_SERVICE_UUID
    });
    this.discoveredDevices = new Map();
    this.connectedDevices = new Map();
    this.setupNoble();
  }

  setupNoble() {
    noble.on('stateChange', (state) => {
      console.log('Detailed Bluetooth state change:', state);
      if (state === 'poweredOn' && !this.isScanning) {
        this.startScanningWithRetry();
      }
    });

    noble.on('discover', (peripheral) => {
      const deviceKey = `${peripheral.id}-${peripheral.advertisement.localName}`;
      
      // Only log if we haven't seen this device before
      if (!this.seenDevices.has(deviceKey)) {
        this.seenDevices.add(deviceKey);
        console.log('\nNew Device Found:', {
          name: peripheral.advertisement.localName,
          id: peripheral.id,
          serviceUUIDs: peripheral.advertisement.serviceUuids
        });
      }
      
      this.handleDiscoveredDevice(peripheral);
    });

    noble.on('scanStart', () => {
      this.isScanning = true;
      console.log('Scan started...');
    });

    noble.on('scanStop', () => {
      this.isScanning = false;
      console.log('Scan stopped...');
    });

    noble.on('error', (error) => {
      console.error('Noble error:', error);
    });
  }

  startScanningWithRetry() {
    if (this.isScanning) {
      return; // Skip if already scanning
    }

    console.log('Starting new scan cycle...');
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }
    
    const startScanCycle = () => {
      if (!this.isScanning && this.connectedDevices.size === 0) {
        noble.startScanning([], true);
      }
    };

    startScanCycle();
    this.scanInterval = setInterval(startScanCycle, 5000);
  }

  handleDiscoveredDevice(peripheral) {
    const isCosmoDevice = 
        peripheral.advertisement.localName?.includes('Cosmo') ||
        peripheral.advertisement.localName?.includes('COSMO') ||
        (peripheral.advertisement.serviceUuids && 
         peripheral.advertisement.serviceUuids.some(uuid => 
           uuid.toLowerCase().replace(/[^a-f0-9]/g, '') === 
           BLE_SERVICE_UUID.toLowerCase().replace(/[^a-f0-9]/g, '')
         ));

    if (isCosmoDevice && !this.discoveredDevices.has(peripheral.id)) {
        console.log('\n🎯 COSMO DEVICE FOUND!');
        console.log('Name:', peripheral.advertisement.localName);
        console.log('ID:', peripheral.id);
        console.log('Service UUIDs:', peripheral.advertisement.serviceUuids);
        console.log('====================\n');

        const deviceInfo = {
            id: peripheral.id,
            name: peripheral.advertisement.localName || 'Unknown Device',
            connected: false,
            rssi: peripheral.rssi,
            serviceUuids: peripheral.advertisement.serviceUuids || []
        };

        this.discoveredDevices.set(peripheral.id, { peripheral, info: deviceInfo });
        
        if (peripheral.advertisement.localName === 'Cosmo' && 
            peripheral.advertisement.serviceUuids?.includes('000015231212efde1523785feabcd123')) {
            console.log('Attempting to connect to Cosmo device...');
            
            // Stop scanning before attempting to connect
            noble.stopScanning();
            
            this.connectToDevice(peripheral.id).then(success => {
                if (success) {
                    console.log('Connected successfully to Cosmo device!');
                    // After successful connection, emit the connected device
                    this.emit('deviceConnected', deviceInfo);
                } else {
                    console.log('Connection failed, restarting scan...');
                    this.startScanning();
                }
            }).catch(error => {
                console.error('Connection error:', error);
                console.log('Restarting scan after error...');
                this.startScanning();
            });
        }

        peripheral.setMaxListeners(2);
        
        peripheral.on('connect', () => {
            deviceInfo.connected = true;
            this.connectedDevices.set(peripheral.id, { peripheral, info: deviceInfo });
        });

        peripheral.on('disconnect', () => {
            console.log('Device disconnected:', deviceInfo.name);
            this.handleDeviceDisconnect(peripheral.id);
        });

        this.emit('deviceDiscovered', deviceInfo);
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
      
      // Use the new startScanning method
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
        console.log('Connecting to device:', device.info.name);
        await device.peripheral.connectAsync();
        this.connectedDevices.set(deviceId, device);
        
        // Discover all services
        console.log('Discovering services...');
        const services = await device.peripheral.discoverServicesAsync();
        console.log('Found services:', services.map(s => s.uuid));
        
        device.characteristics = new Map();

        // Process each service
        for (const service of services) {
          console.log(`\nExploring service: ${service.uuid}`);
          const characteristics = await service.discoverCharacteristicsAsync();
          console.log('Found characteristics:', characteristics.map(c => c.uuid));
          
          for (const characteristic of characteristics) {
            const normalizedCharUUID = normalizeUUID(characteristic.uuid);
            console.log(`Processing characteristic: ${characteristic.uuid}`);
            console.log('Properties:', characteristic.properties);
            
            // Store characteristic with both formats of UUID
            device.characteristics.set(characteristic.uuid, characteristic);
            device.characteristics.set(normalizedCharUUID, characteristic);

            try {
                // Handle sensor characteristic
                if (normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.SENSOR)) {
                    console.log('Found sensor characteristic');
                    await characteristic.subscribeAsync();
                    characteristic.on('data', (data) => {
                        this.handleCharacteristicData(deviceId, BLE_CHARACTERISTICS.SENSOR, data);
                    });
                }
                // Handle button status characteristic
                else if (normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.BUTTON_STATUS)) {
                    console.log('Found button status characteristic');
                    await characteristic.subscribeAsync();
                    characteristic.on('data', (data) => {
                        this.handleCharacteristicData(deviceId, BLE_CHARACTERISTICS.BUTTON_STATUS, data);
                    });
                }
                // Handle battery level characteristic
                else if (normalizedCharUUID === normalizeUUID(BLE_CHARACTERISTICS.BATTERY_LEVEL)) {
                    console.log('Found battery level characteristic');
                    const batteryData = await characteristic.readAsync();
                    device.info.batteryLevel = batteryData[0];
                    await characteristic.subscribeAsync();
                    characteristic.on('data', (data) => {
                        this.handleCharacteristicData(deviceId, BLE_CHARACTERISTICS.BATTERY_LEVEL, data);
                    });
                }
                // Read device information characteristics
                else if (characteristic.uuid === '2a29') { // Manufacturer Name
                    const data = await characteristic.readAsync();
                    console.log('Manufacturer:', data.toString());
                }
                else if (characteristic.uuid === '2a25') { // Serial Number
                    const data = await characteristic.readAsync();
                    device.info.serialNumber = data.toString().trim();
                    console.log('Serial Number:', device.info.serialNumber);
                }
                else if (characteristic.uuid === '2a27') { // Hardware Version
                    const data = await characteristic.readAsync();
                    device.info.hardwareVersion = data.toString().trim();
                    console.log('Hardware Version:', device.info.hardwareVersion);
                }
                else if (characteristic.uuid === '2a26') { // Firmware Version
                    const data = await characteristic.readAsync();
                    device.info.firmwareVersion = data.toString().trim();
                    console.log('Firmware Version:', device.info.firmwareVersion);
                }
            } catch (error) {
                console.error('Error handling characteristic:', characteristic.uuid, error.message);
            }
          }
        }

        // Emit device info after reading all characteristics
        this.emit('deviceUpdated', {
          devices: this.getAllDevices(),
          deviceInfo: {
            [deviceId]: {
              serialNumber: device.info.serialNumber || 'Unknown',
              hardwareRevision: device.info.hardwareVersion || 'Unknown',
              firmwareRevision: device.info.firmwareVersion || 'Unknown',
              batteryLevel: device.info.batteryLevel || null
            }
          }
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

  // Add this method to match the WebSocket server's expectation
  startScanning() {
    this.startScanningWithRetry();
  }
}

module.exports = { BLEServer };

