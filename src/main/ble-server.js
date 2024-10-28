// BLE server implementation for device management
const noble = require('@abandonware/noble');
const EventEmitter = require('events');
const { BLE_SERVICE_UUID, BLE_CHARACTERISTICS } = require('../common/constants');

// Define the service UUIDs we're interested in (without hyphens)
const MAIN_SERVICE_UUID = '000015231212efde1523785feabcd123';

// Helper function to format UUID for CoreBluetooth
function formatUUID(uuid) {
  // Remove any existing hyphens and lowercase
  uuid = uuid.replace(/-/g, '').toLowerCase();
  
  // Insert hyphens in the correct positions for 128-bit UUID
  return uuid.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/,
    '$1-$2-$3-$4-$5');
}

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
  }

  startScanning() {
    console.log('Starting BLE scan for Cosmo devices...');
    // First stop any existing scan
    noble.stopScanning(() => {
      // Start scanning only for Cosmo service UUID
      noble.startScanning([MAIN_SERVICE_UUID], true, (error) => {
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
        deviceInfo.connected = false;
        this.connectedDevices.delete(peripheral.id);
        this.emit('deviceDisconnected', deviceInfo);
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
        const formattedServiceUUID = formatUUID(MAIN_SERVICE_UUID);
        console.log('Using service UUID:', formattedServiceUUID);

        // First discover services
        const services = await device.peripheral.discoverServicesAsync([formattedServiceUUID]);
        console.log('Discovered services:', services);

        if (!services || services.length === 0) {
          throw new Error('No matching services found');
        }

        // Then discover characteristics for the first matching service
        const service = services[0];
        const formattedCharacteristicUUIDs = Object.values(BLE_CHARACTERISTICS)
          .map(uuid => formatUUID(uuid));
        
        console.log('Looking for characteristics:', formattedCharacteristicUUIDs);
        
        // Discover characteristics
        const characteristics = await service.discoverCharacteristicsAsync(formattedCharacteristicUUIDs);
        console.log('Found characteristics:', characteristics);
        
        if (!characteristics || characteristics.length === 0) {
          throw new Error('No characteristics found');
        }

        device.characteristics = characteristics;
        
        // Setup notifications for each characteristic
        for (const char of characteristics) {
          try {
            console.log('Setting up notifications for characteristic:', char.uuid);
            await char.subscribeAsync();
            char.on('data', (data) => {
              console.log('Received data from characteristic:', char.uuid, data);
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
        
        return true;
      } catch (error) {
        console.error('Failed to connect:', error);
        try {
          await device.peripheral.disconnectAsync();
        } catch (disconnectError) {
          console.error('Failed to disconnect after failed connection:', disconnectError);
        }
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
        .find(c => c.uuid === formatUUID(characteristicUUID));
      
      if (characteristic) {
        await characteristic.writeAsync(Buffer.from(value), false);
        return true;
      }
    }
    return false;
  }
}

module.exports = { BLEServer };
