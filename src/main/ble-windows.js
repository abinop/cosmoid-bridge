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
        id: peripheral.uuid,
        name: peripheral.advertisement.localName,
        peripheral,
        connected: false,
        connecting: true,
        serial: null,
        firmware: null,
        batteryLevel: null,
        sensorValue: 0,
        buttonState: false,
        pressValue: 0,
        rssi: peripheral.rssi
      };
      this.devices.set(peripheral.uuid, device);

      await peripheral.connectAsync();
      device.connected = true;
      device.connecting = false;
      this.log('Connected to device', peripheral.uuid);

      const services = await this.discoverServicesAsync(peripheral);
      this.log('Services discovered', services);

      // Discover characteristics for each service
      const deviceInfoChars = await this.discoverCharacteristicsAsync(peripheral, '180a');
      const batteryChars = await this.discoverCharacteristicsAsync(peripheral, '180f');
      const cosmoChars = await this.discoverCharacteristicsAsync(peripheral, this.COSMO_SERVICE_UUID.replace(/-/g, ''));

      // Read static characteristics
      const [serial, firmware, battery] = await Promise.all([
        this.readCharacteristicAsync(deviceInfoChars, '2a25'),
        this.readCharacteristicAsync(deviceInfoChars, '2a26'),
        this.readCharacteristicAsync(batteryChars, '2a19')
      ]);

      device.serial = serial?.toString();
      device.firmware = firmware?.toString();
      device.batteryLevel = battery ? parseInt(battery.toString()) : null;

      // Subscribe to button and sensor characteristics
      await Promise.all([
        this.subscribeToCharacteristic(cosmoChars, this.BUTTON_STATUS_CHARACTERISTIC_UUID.replace(/-/g, ''), (data) => {
          this.handleButtonStatus(peripheral.uuid, data);
        }),
        this.subscribeToCharacteristic(cosmoChars, this.SENSOR_CHARACTERISTIC_UUID.replace(/-/g, ''), (data) => {
          this.handleSensorData(peripheral.uuid, data);
        })
      ]);

      this.emit('deviceConnected', device);
      this.emit('deviceUpdate', device);

    } catch (error) {
      this.log('Error connecting to device', {
        uuid: peripheral.uuid,
        error: error.toString(),
        stack: error.stack
      });
      this.handleDeviceDisconnection(peripheral.uuid);
    }
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
      const services = await peripheral.discoverServicesAsync();
      const service = services.find(s => s.uuid === serviceUuid);
      if (!service) {
        throw new Error(`Service not found: ${serviceUuid}`);
      }
      return await service.discoverCharacteristicsAsync();
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
        return null;
      }
      return await characteristic.readAsync();
    } catch (error) {
      this.log('Error reading characteristic', {
        uuid: characteristicUuid,
        error: error.toString(),
        stack: error.stack
      });
      return null;
    }
  }

  async subscribeToCharacteristic(characteristics, characteristicUuid, callback) {
    try {
      const characteristic = characteristics.find(c => c.uuid === characteristicUuid);
      if (!characteristic) {
        this.log('Characteristic not found', characteristicUuid);
        return;
      }
      await characteristic.subscribeAsync();
      characteristic.on('data', callback);
    } catch (error) {
      this.log('Error subscribing to characteristic', {
        uuid: characteristicUuid,
        error: error.toString(),
        stack: error.stack
      });
    }
  }

  handleButtonStatus(deviceId, data) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const buttonState = data[0] === 1;
    const pressValue = data[1] || 0;

    device.buttonState = buttonState;
    device.pressValue = pressValue;

    this.emit('buttonEvent', {
      deviceId,
      pressed: buttonState,
      value: pressValue
    });

    this.emit('deviceUpdate', device);
  }

  handleSensorData(deviceId, data) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const sensorValue = data.readUInt16LE(0);
    device.sensorValue = sensorValue;

    this.emit('deviceUpdate', device);
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
      buttonState: device.buttonState,
      pressValue: device.pressValue,
      rssi: device.rssi,
      connected: device.connected
    }));
    this.log('Emitting all devices', devices);
    this.emit('deviceList', devices);
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