const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const noble = require('@abandonware/noble');
const { ipcMain } = require('electron');
const EventEmitter = require('events');

class BLEManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this._scanning = false;
    this._connectionCheckInterval = null;
    
    // Cosmo device UUIDs - stored without hyphens for noble compatibility
    this.DEVICE_INFO_SERVICE_UUID = '0000180a0000100080000805f9b34fb';
    this.SERIAL_CHARACTERISTIC_UUID = '00002a250000100080000805f9b34fb';
    this.FIRMWARE_CHARACTERISTIC_UUID = '00002a260000100080000805f9b34fb';
    this.COSMO_SERVICE_UUID = '000015231212efde1523785feabcd123';
    this.SENSOR_CHARACTERISTIC_UUID = '000015241212efde1523785feabcd123';
    this.BUTTON_STATUS_CHARACTERISTIC_UUID = '000015251212efde1523785feabcd123';
    this.COMMAND_CHARACTERISTIC_UUID = '000015281212efde1523785feabcd123';
    this.BATTERY_SERVICE_UUID = '0000180f0000100080000805f9b34fb';
    this.BATTERY_CHARACTERISTIC_UUID = '00002a190000100080000805f9b34fb';
    
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : '/var/local');
    this.logPath = path.join(appDataPath, 'Cosmoid Bridge', 'debug.log');
    
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.setupNoble();
    this.setupIPC();
    this.log('BLEManager', 'Initialized');
  }

  setupIPC() {
    ipcMain.on('requestDevices', () => {
      this.emitAllDevices();
    });
  }

  setupNoble() {
    noble.on('stateChange', (state) => {
      this.log('Bluetooth state changed', state);
      if (state === 'poweredOn' && this._scanning) {
        this.startActualScan();
      }
    });

    noble.on('discover', async (peripheral) => {
      await this.handleDiscoveredDevice(peripheral);
    });

    // Handle disconnection
    noble.on('disconnect', async (peripheral) => {
      this.log('Device disconnected', peripheral.uuid);
      if (this.devices.has(peripheral.uuid)) {
        const device = this.devices.get(peripheral.uuid);
        device.connected = false;
        this.emit('deviceDisconnected', {
          id: peripheral.uuid,
          name: device.name
        });
        this.devices.delete(peripheral.uuid);
        this.emit('deviceUpdate', {
          id: peripheral.uuid,
          name: device.name,
          connected: false
        });
      }
    });
  }

  async handleDiscoveredDevice(peripheral) {
    if (!peripheral.advertisement.localName?.startsWith('Cosmo')) {
      return;
    }

    this.log('Cosmo device found', {
      name: peripheral.advertisement.localName,
      uuid: peripheral.uuid,
      rssi: peripheral.rssi
    });

    // Skip if already connected or connecting
    if (this.devices.has(peripheral.uuid)) {
      const device = this.devices.get(peripheral.uuid);
      if (device.connected || device.connecting) {
        return;
      }
    }

    try {
      const device = {
        name: peripheral.advertisement.localName,
        uuid: peripheral.uuid,
        peripheral,
        connected: false,
        connecting: true,
        properties: {}
      };
      this.devices.set(peripheral.uuid, device);

      await peripheral.connectAsync();
      device.connected = true;
      device.connecting = false;
      this.log('Connected to device', peripheral.uuid);

      const services = await this.discoverServicesAsync(peripheral);
      this.log('Services discovered', services);

      // Discover all characteristics in parallel
      const [deviceInfoChars, batteryChars, cosmoChars] = await Promise.all([
        this.discoverCharacteristicsAsync(peripheral, this.DEVICE_INFO_SERVICE_UUID),
        this.discoverCharacteristicsAsync(peripheral, this.BATTERY_SERVICE_UUID),
        this.discoverCharacteristicsAsync(peripheral, this.COSMO_SERVICE_UUID)
      ]);

      // Read static characteristics in parallel
      const [serial, firmware, battery] = await Promise.all([
        this.readCharacteristicAsync(deviceInfoChars, this.SERIAL_CHARACTERISTIC_UUID),
        this.readCharacteristicAsync(deviceInfoChars, this.FIRMWARE_CHARACTERISTIC_UUID),
        this.readCharacteristicAsync(batteryChars, this.BATTERY_CHARACTERISTIC_UUID)
      ]);

      device.properties = {
        serial: serial?.toString(),
        firmware: firmware?.toString(),
        battery: battery ? parseInt(battery.toString()) : null,
        buttonState: false,
        pressValue: 0,
        rssi: peripheral.rssi
      };

      // Subscribe to button and sensor characteristics
      await Promise.all([
        this.subscribeToCharacteristic(cosmoChars, this.BUTTON_STATUS_CHARACTERISTIC_UUID, (data) => {
          this.handleButtonStatus(peripheral.uuid, data);
        }),
        this.subscribeToCharacteristic(cosmoChars, this.SENSOR_CHARACTERISTIC_UUID, (data) => {
          this.handleSensorData(peripheral.uuid, data);
        })
      ]);

      this.emit('deviceConnected', {
        id: peripheral.uuid,
        name: device.name,
        properties: device.properties
      });

    } catch (error) {
      this.log('Error connecting to device', {
        uuid: peripheral.uuid,
        error: error.toString(),
        stack: error.stack
      });
      this.handleDeviceDisconnection(peripheral.uuid);
    }
  }

  handleButtonStatus(deviceId, data) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const buttonState = data[0] === 1;
    const pressValue = data[1] || 0;

    device.properties.buttonState = buttonState;
    device.properties.pressValue = pressValue;

    this.emit('buttonEvent', {
      deviceId,
      pressed: buttonState,
      value: pressValue
    });

    this.emit('propertyUpdate', {
      deviceId,
      properties: device.properties
    });
  }

  handleSensorData(deviceId, data) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const sensorValue = data.readUInt16LE(0);
    device.properties.sensor = sensorValue;

    this.emit('propertyUpdate', {
      deviceId,
      properties: device.properties
    });
  }

  async discoverServicesAsync(peripheral) {
    try {
      const services = await peripheral.discoverServicesAsync();
      return services.map(s => s.uuid);
    } catch (error) {
      this.log('Error discovering services', {
        uuid: peripheral.uuid,
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }

  async discoverCharacteristicsAsync(peripheral, serviceUuid) {
    try {
      const service = await peripheral.getServiceAsync(serviceUuid);
      const characteristics = await service.discoverCharacteristicsAsync();
      return characteristics;
    } catch (error) {
      this.log('Error discovering characteristics', {
        uuid: peripheral.uuid,
        service: serviceUuid,
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }

  async readCharacteristicAsync(characteristics, characteristicUuid) {
    try {
      const characteristic = characteristics.find(c => c.uuid === characteristicUuid);
      if (!characteristic) {
        throw new Error(`Characteristic not found: ${characteristicUuid}`);
      }
      const data = await characteristic.readAsync();
      return data;
    } catch (error) {
      this.log('Error reading characteristic', {
        uuid: characteristicUuid,
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }

  async subscribeToCharacteristic(characteristics, characteristicUuid, callback) {
    try {
      const characteristic = characteristics.find(c => c.uuid === characteristicUuid);
      if (!characteristic) {
        throw new Error(`Characteristic not found: ${characteristicUuid}`);
      }
      await characteristic.subscribeAsync();
      characteristic.on('data', callback);
    } catch (error) {
      this.log('Error subscribing to characteristic', {
        uuid: characteristicUuid,
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }

  async handleDeviceDisconnection(uuid) {
    if (this.devices.has(uuid)) {
      const device = this.devices.get(uuid);
      device.connected = false;
      this.emit('deviceDisconnected', {
        id: uuid,
        name: device.name
      });
      this.devices.delete(uuid);
      this.emit('deviceUpdate', {
        id: uuid,
        name: device.name,
        connected: false
      });
    }
  }

  emitDeviceUpdate(deviceInfo) {
    // Send to all renderer processes
    const cleanDeviceInfo = {
      id: deviceInfo.id,
      name: deviceInfo.name,
      serial: deviceInfo.serial,
      firmware: deviceInfo.firmware,
      batteryLevel: deviceInfo.batteryLevel,
      sensorValue: deviceInfo.sensorValue,
      pressValue: deviceInfo.pressValue,
      buttonState: deviceInfo.buttonState,
      rssi: deviceInfo.rssi,
      connected: deviceInfo.connected
    };
    
    this.log('Emitting device update', cleanDeviceInfo);
    global.mainWindow?.webContents.send('deviceUpdate', cleanDeviceInfo);
  }

  emitAllDevices() {
    const devices = Array.from(this.devices.values()).map(device => ({
      id: device.id,
      name: device.name,
      serial: device.serial,
      firmware: device.firmware,
      batteryLevel: device.batteryLevel,
      sensorValue: device.sensorValue,
      pressValue: device.pressValue,
      buttonState: device.buttonState,
      rssi: device.rssi,
      connected: device.connected
    }));
    
    this.log('Emitting all devices', devices);
    global.mainWindow?.webContents.send('deviceList', devices);
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
    console.log(logMessage);
    fs.appendFileSync(this.logPath, logMessage);
  }

  startActualScan() {
    noble.startScanningAsync([], false)
      .then(() => {
        this.log('Scanning started', null);
      })
      .catch((error) => {
        this.log('Error starting scan', {
          error: error.toString(),
          stack: error.stack
        });
      });
  }

  startScanning() {
    return new Promise((resolve, reject) => {
      if (this._scanning) {
        resolve();
        return;
      }

      this._scanning = true;
      noble.startScanning([], true, (error) => {
        if (error) {
          this._scanning = false;
          this.log('Error starting scan', error);
          reject(error);
        } else {
          this.log('Scanning started', null);
          resolve();
        }
      });

      // Periodically check device connections
      this._connectionCheckInterval = setInterval(() => {
        for (const [uuid, device] of this.devices.entries()) {
          if (device.peripheral && device.peripheral.state !== 'connected') {
            this.log('Device connection lost', uuid);
            this.handleDeviceDisconnection(uuid, device);
          }
        }
      }, 5000);
    });
  }

  stopScanning() {
    return new Promise((resolve, reject) => {
      this._scanning = false;
      if (this._connectionCheckInterval) {
        clearInterval(this._connectionCheckInterval);
      }
      noble.stopScanning((error) => {
        if (error) {
          this.log('Error stopping scan', error);
          reject(error);
        } else {
          this.log('Stopped scanning', null);
          resolve();
        }
      });
    });
  }

  async setColor(deviceId, r, g, b, mode = 1) {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error('Device not found');
    }

    try {
      const commandChar = deviceInfo.service.characteristics.find(c => c.uuid === this.COMMAND_CHARACTERISTIC_UUID);
      if (!commandChar) {
        throw new Error('Command characteristic not found');
      }

      const command = Buffer.from([2, r, g, b, mode]); // 2 is SET_COLOR command
      await commandChar.writeAsync(command, true);
    } catch (error) {
      this.log('Error setting color', {
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }

  async setBrightness(deviceId, intensity, delay = 1) {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error('Device not found');
    }

    try {
      const commandChar = deviceInfo.service.characteristics.find(c => c.uuid === this.COMMAND_CHARACTERISTIC_UUID);
      if (!commandChar) {
        throw new Error('Command characteristic not found');
      }

      const command = Buffer.from([1, intensity, delay]); // 1 is SET_LUMINOSITY command
      await commandChar.writeAsync(command, true);
    } catch (error) {
      this.log('Error setting brightness', {
        error: error.toString(),
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new BLEManager();