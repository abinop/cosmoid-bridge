const { BrowserWindow } = require('electron');
const noble = require('@abandonware/noble');
const EventEmitter = require('events');

const FORCE_SENSOR_UUID = '000015241212efde1523785feabcd123';
const BUTTON_PRESS_UUID = '000015251212efde1523785feabcd123';

class BLEServer extends EventEmitter {
  constructor() {
    super();
    this.knownDevices = new Map();
    this.isScanning = false;
    this.mainWindow = null;
    this.isPoweredOn = false;
    this.DEBUG = true;
    
    this.COSMO_SERVICE_UUIDS = [
      '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
      '6e400001b5a3f393e0a9e50e24dcca9e',
      '00001523-1212-efde-1523-785feabcd123',
      '000015231212efde1523785feabcd123'
    ];
    this.SCAN_TIMEOUT = 30000;
    this.RSSI_THRESHOLD = -100;
    this.scanInterval = null;

    // Remove noble listeners on creation
    noble.removeAllListeners();
  }

  initialize(mainWindow) {
    this.mainWindow = mainWindow;
    
    // Reset noble state
    noble.removeAllListeners();
    
    noble.on('stateChange', async (state) => {
      this.isPoweredOn = state === 'poweredOn';
      if (this.isPoweredOn) {
        await this.forceStartScan();
      }
    });

    noble.on('discover', (peripheral) => {
      if (peripheral.advertisement.localName?.includes('Cosmo') ||
          peripheral.advertisement.serviceUuids?.some(uuid => 
            this.COSMO_SERVICE_UUIDS.map(u => u.toLowerCase()).includes(uuid.toLowerCase())
          )) {
        this.handleDiscovery(peripheral);
      }
    });

    if (noble.state === 'poweredOn') {
      this.isPoweredOn = true;
      this.forceStartScan();
    }
  }

  async forceStartScan() {
    try {
      if (this.isScanning) {
        await noble.stopScanningAsync();
        this.isScanning = false;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      await noble.startScanningAsync([], true);
      this.isScanning = true;
    } catch (error) {
      console.error('Scan error:', error);
      setTimeout(() => this.forceStartScan(), 2000);
    }
  }

  async handleDiscovery(peripheral) {
    const details = {
        name: peripheral.advertisement.localName,
        uuid: peripheral.uuid,
        rssi: peripheral.rssi,
        services: peripheral.advertisement.serviceUuids || []
    };
    
    const deviceInfo = {
        id: peripheral.id,
        name: details.name || 'Unknown Cosmo',
        lastSeen: Date.now(),
        peripheral: peripheral,
        connected: false,
        rssi: peripheral.rssi
    };

    this.knownDevices.set(peripheral.id, deviceInfo);
    
    try {
        await this.connectToDevice(peripheral.id);
    } catch (error) {
        if (!error.message.includes('already connected')) {
            console.error('Connection error:', error);
        } else {
            deviceInfo.connected = true;
            this.broadcastDevices();
        }
    }
  }

  broadcastDevices() {
    const devices = this.getCleanDevices();
    const connectedDevices = devices.filter(d => d.connected);
    console.log('Broadcasting devices update:', connectedDevices);
    
    // Emit both events to ensure proper updates
    this.emit('deviceUpdated', {
      type: 'devicesList',
      devices: connectedDevices
    });
    
    // Also emit through the window if it exists
    if (this.mainWindow) {
      this.mainWindow.webContents.send('devicesUpdated', {
        type: 'devicesList',
        devices: connectedDevices
      });
    }
  }

  isCosmoManufacturerData(manufacturerData) {
    if (!manufacturerData || manufacturerData.length < 2) return false;
    
    const manufacturerId = manufacturerData.readUInt16LE(0);
    return manufacturerId === 0x0483;
  }

  updateDeviceLastSeen(deviceId) {
    const device = this.knownDevices.get(deviceId);
    if (device) {
      device.lastSeen = Date.now();
    }
  }

  cleanupDisconnectedDevices() {
    const now = Date.now();
    const timeout = 60000;

    for (const [deviceId, device] of this.knownDevices.entries()) {
      if (!device.connected && (now - device.lastSeen) > timeout) {
        console.log('Removing inactive device:', deviceId);
        this.knownDevices.delete(deviceId);
        this.notifyDeviceRemoved(deviceId);
      }
    }
  }

  notifyDeviceDiscovered(deviceId) {
    const device = this.knownDevices.get(deviceId);
    if (device && this.mainWindow) {
      this.mainWindow.webContents.send('deviceDiscovered', {
        id: device.id,
        name: device.name
      });
    }
  }

  notifyDeviceRemoved(deviceId) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send('deviceRemoved', { id: deviceId });
    }
  }

  getAllDevices() {
    return this.getConnectedDevices();
  }

  async connectToDevice(deviceId) {
    const device = this.knownDevices.get(deviceId);
    if (!device) throw new Error('Device not found');

    try {
        if (!device.connected) {
            await device.peripheral.connectAsync();
            device.connected = true;
            console.log(`Connected to Cosmo device: ${device.name}`);

            // Broadcast immediately after successful connection
            this.emit('deviceConnected', this.getCleanDeviceInfo(device));
            this.broadcastDevices();

            device.peripheral.once('disconnect', () => {
                device.connected = false;
                console.log(`Cosmo device disconnected: ${device.name}`);
                this.emit('deviceDisconnected', this.getCleanDeviceInfo(device));
                this.broadcastDevices();
            });

            // Set up characteristic notifications
            const services = await device.peripheral.discoverServicesAsync();
            for (const service of services) {
                const characteristics = await service.discoverCharacteristicsAsync();
                for (const characteristic of characteristics) {
                    if (characteristic.uuid === FORCE_SENSOR_UUID || 
                        characteristic.uuid === BUTTON_PRESS_UUID) {
                        await characteristic.subscribeAsync();
                        characteristic.on('data', (data) => {
                            this.emit('characteristicChanged', {
                                deviceId,
                                characteristicUUID: characteristic.uuid,
                                value: Array.from(data)
                            });
                        });
                    }
                }
            }
        }
        return device;
    } catch (error) {
        if (error.message.includes('already connected')) {
            device.connected = true;
            // Broadcast for already connected devices too
            this.emit('deviceConnected', this.getCleanDeviceInfo(device));
            this.broadcastDevices();
            return device;
        }
        throw error;
    }
  }

  async disconnectDevice(deviceId) {
    const device = this.knownDevices.get(deviceId);
    if (!device) return;

    try {
      await device.peripheral.disconnectAsync();
      device.connected = false;
      
      this.emit('deviceDisconnected', {
        id: device.id,
        name: device.name
      });
      
    } catch (error) {
      console.error('Error disconnecting device:', error);
    }
  }

  getCleanDeviceInfo(device) {
    return {
      id: device.id,
      name: device.name,
      connected: device.connected,
      rssi: device.rssi,
      lastSeen: device.lastSeen
    };
  }

  getCleanDevices() {
    return Array.from(this.knownDevices.values()).map(device => ({
      id: device.id,
      name: device.name,
      connected: device.connected,
      rssi: device.rssi,
      lastSeen: device.lastSeen
    }));
  }

  async setColor(deviceId, rgb) {
    // Implementation for setting LED color
    // This will need to be implemented based on your device's specific characteristics
  }

  async setLuminosity(deviceId, value) {
    // Implementation for setting LED luminosity
    // This will need to be implemented based on your device's specific characteristics
  }

  getConnectedDevices() {
    return this.getCleanDevices().filter(d => d.connected);
  }
}

const bleServer = new BLEServer();

module.exports = {
  BLEServer,
  bleServer
};

