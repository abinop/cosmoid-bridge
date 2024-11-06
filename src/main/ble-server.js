const os = require('os');
const path = require('path');
const { app } = require('electron');
const EventEmitter = require('events');

let noble;
const platform = os.platform();

// Initialize the correct BLE module based on platform
async function initializeBLE() {
  try {
    if (platform === 'win32') {
      console.log('Initializing BLE for Windows...');
      const NobleBindings = require('@abandonware/noble/lib/binding/win32/binding');
      const Noble = require('@abandonware/noble/lib/noble');
      const binding = new NobleBindings();
      noble = new Noble(binding);
    } else if (platform === 'darwin') {
      console.log('Initializing BLE for macOS...');
      noble = require('@abandonware/noble');
    } else {
      console.log('Initializing BLE for Linux...');
      noble = require('@abandonware/noble');
    }

    // Wait for noble to be ready
    await new Promise((resolve, reject) => {
      if (noble.state === 'poweredOn') {
        resolve();
      } else {
        noble.once('stateChange', (state) => {
          if (state === 'poweredOn') {
            resolve();
          } else {
            reject(new Error(`Bluetooth adapter state: ${state}`));
          }
        });

        // Add timeout
        setTimeout(() => {
          reject(new Error('Bluetooth initialization timeout'));
        }, 10000);
      }
    });

    return noble;
  } catch (error) {
    console.error('Failed to initialize BLE:', error);
    throw error;
  }
}

class BLEServer extends EventEmitter {
  constructor() {
    super();
    this.discoveredDevices = new Map();
    this.connectedDevices = new Map();
    this.noble = null;
    this.initialize();
  }

  async initialize() {
    try {
      this.noble = await initializeBLE();
      this.setupNoble();
      console.log('BLE initialized successfully');
    } catch (error) {
      console.error('Failed to initialize BLE:', error);
      this.emit('error', error);
    }
  }

  setupNoble() {
    noble.on('stateChange', async (state) => {
      console.log('Bluetooth adapter state changed to:', state);
      if (state === 'poweredOn') {
        console.log('Bluetooth adapter is powered on and ready');
        this.discoveredDevices.clear();
        this.connectedDevices.clear();
        this.emit('ready');
        await this.startScanning();
      } else {
        console.log('Bluetooth adapter is not ready:', state);
        noble.stopScanning();
        for (const [deviceId, device] of this.connectedDevices) {
          try {
            await device.peripheral.disconnectAsync();
          } catch (error) {
            console.error(`Failed to disconnect device ${deviceId}:`, error);
          }
        }
        this.discoveredDevices.clear();
        this.connectedDevices.clear();
        
        if (state === 'poweredOff') {
          this.emit('error', new Error('Bluetooth is powered off'));
        } else if (state === 'unauthorized') {
          this.emit('error', new Error('Bluetooth access is unauthorized'));
        } else if (state === 'unsupported') {
          this.emit('error', new Error('Bluetooth Low Energy is not supported'));
        }
      }
    });

    // Add state query on initialization
    console.log('Current Bluetooth adapter state:', noble.state);

    noble.on('discover', (peripheral) => {
      this.handleDiscoveredDevice(peripheral);
    });

    noble.on('scanStart', () => {
      console.log('Scanning started for Cosmo devices...');
    });

    noble.on('scanStop', () => {
      console.log('Scanning stopped...');
    });

    noble.on('disconnect', (peripheral) => {
      console.log('Device disconnected:', peripheral.id);
      this.handleDeviceDisconnect(peripheral.id);
    });
  }

  startScanning() {
    console.log('Starting BLE scan for Cosmo devices...');
    
    noble.stopScanning(() => {
      // Scan for all devices instead of filtering by UUID
      noble.startScanning([], true, (error) => {
        if (error) {
          console.error('Failed to start scanning:', error);
        } else {
          console.log('Scanning started for all devices, will filter Cosmo devices in handler');
        }
      });
    });
  }

  handleDiscoveredDevice(peripheral) {
    // Log all discovered devices for debugging
    console.log('Found device:', {
      id: peripheral.id,
      name: peripheral.advertisement.localName,
      serviceUuids: peripheral.advertisement.serviceUuids,
      manufacturerData: peripheral.advertisement.manufacturerData ? 
        peripheral.advertisement.manufacturerData.toString('hex') : 'none'
    });

    // Check if this is a Cosmo device by name
    if (peripheral.advertisement.localName === 'Cosmo') {
      if (!this.discoveredDevices.has(peripheral.id)) {
        console.log('Adding new Cosmo device:', {
          id: peripheral.id,
          name: peripheral.advertisement.localName,
          rssi: peripheral.rssi
        });
        
        const deviceInfo = {
          id: peripheral.id,
          name: peripheral.advertisement.localName || 'Unknown Device',
          connected: false,
          rssi: peripheral.rssi
        };

        this.discoveredDevices.set(peripheral.id, { peripheral, info: deviceInfo });
        
        peripheral.setMaxListeners(2);
        
        peripheral.on('connect', () => {
          console.log('Device connected:', deviceInfo.name);
          deviceInfo.connected = true;
          this.connectedDevices.set(peripheral.id, { peripheral, info: deviceInfo });
          this.emit('deviceConnected', deviceInfo);
        });

        peripheral.on('disconnect', () => {
          console.log('Device disconnected:', deviceInfo.name);
          this.handleDeviceDisconnect(peripheral.id);
        });

        // Emit deviceFound event
        this.emit('deviceFound', deviceInfo);
      } else {
        const device = this.discoveredDevices.get(peripheral.id);
        if (Math.abs(device.info.rssi - peripheral.rssi) > 5) {
          device.info.rssi = peripheral.rssi;
          this.emit('deviceUpdated', device.info);
        }
      }
    }
  }

  async connectToDevice(deviceId) {
    console.log('BLE Server: Connecting to device:', deviceId);
    
    const device = this.discoveredDevices.get(deviceId);
    
    if (!device) {
      console.error('Device not found:', deviceId);
      throw new Error('Device not found');
    }

    try {
      // First disconnect if already connected
      if (device.peripheral.state === 'connected') {
        console.log('Device already connected, disconnecting first...');
        await device.peripheral.disconnectAsync();
        // Wait a bit before reconnecting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Stop scanning during connection attempt
      await noble.stopScanningAsync();
      
      console.log('Attempting to connect to Cosmo device:', device.info.name);
      console.log('Current peripheral state:', device.peripheral.state);
      
      // Add error handler before attempting connection
      device.peripheral.once('error', (error) => {
        console.error('Peripheral connection error:', error);
      });

      // Add timeout to the connection attempt
      const connectPromise = device.peripheral.connectAsync();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000);
      });

      await Promise.race([connectPromise, timeoutPromise]);
      
      if (device.peripheral.state !== 'connected') {
        throw new Error(`Failed to connect. Device state: ${device.peripheral.state}`);
      }

      console.log('Connected successfully to:', device.info.name);

      console.log('Discovering services and characteristics...');
      
      const services = await device.peripheral.discoverServicesAsync([SERVICE_UUID]);
      console.log('Discovered services:', services);

      if (!services || services.length === 0) {
        throw new Error('No matching services found');
      }

      const service = services[0];
      const characteristicUUIDs = [
        CHARACTERISTICS.SENSOR,
        CHARACTERISTICS.BUTTON_STATUS,
        CHARACTERISTICS.COMMAND
      ];
      
      const characteristics = await service.discoverCharacteristicsAsync(characteristicUUIDs);
      console.log('Found characteristics:', characteristics);
      
      if (!characteristics || characteristics.length === 0) {
        throw new Error('No characteristics found');
      }

      // Map characteristics by UUID for easier access
      const characteristicsMap = characteristics.reduce((map, char) => {
        map[char.uuid] = char;
        return map;
      }, {});

      device.characteristics = characteristicsMap;
      if (this.connectedDevices.has(deviceId)) {
        this.connectedDevices.get(deviceId).characteristics = characteristicsMap;
      }

      for (const char of characteristics) {
        try {
          console.log(`Setting up notifications for characteristic: ${char.uuid}`);
          await char.subscribeAsync();
          char.on('data', (data) => {
            this.emit('characteristicChanged', {
              deviceId,
              characteristicUUID: char.uuid,
              value: Array.from(data)
            });
          });
        } catch (notifyError) {
          console.error('Failed to setup notifications for characteristic:', char.uuid, notifyError);
        }
      }

      device.info.connected = true;
      this.connectedDevices.set(deviceId, device);
      this.emit('deviceConnected', device.info);
      
      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        deviceInfo: {
          id: device.info.id,
          name: device.info.name,
          state: device.peripheral.state
        }
      });
      
      this.handleDeviceDisconnect(deviceId);
      throw error;
    } finally {
      // Ensure scanning restarts if it was stopped
      if (!noble.state !== 'scanning') {
        this.startScanning();
      }
    }
  }

  handleDeviceDisconnect(deviceId) {
    const device = this.connectedDevices.get(deviceId);
    if (device) {
      device.info.connected = false;
      this.connectedDevices.delete(deviceId);
      this.emit('deviceDisconnected', device.info);
    }
  }

  getAllDevices() {
    return Array.from(this.discoveredDevices.values()).map(d => d.info);
  }

  async sendEventToDevice(deviceId, eventType, data) {
    const device = this.connectedDevices.get(deviceId);
    if (!device || !device.characteristics) return false;

    try {
      const { command } = device.characteristics;
      let commandData;

      switch (eventType) {
        case 'setLuminosity':
          commandData = Buffer.from([
            COMMANDS.SET_LUMINOSITY,
            data[0],  // intensity
            1        // default delay
          ]);
          break;

        case 'setColor':
          commandData = Buffer.from([
            COMMANDS.SET_COLOR,
            data[0],  // r
            data[1],  // g
            data[2],  // b
            1        // mode
          ]);
          break;

        default:
          throw new Error('Unknown command type: ' + eventType);
      }

      await command.writeValue(commandData);
      return true;
    } catch (error) {
      console.error('Failed to send command:', error);
      return false;
    }
  }
}

module.exports = { BLEServer };

