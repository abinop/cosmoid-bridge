const WebSocket = require('ws');

class WSServer {
  constructor(bleManager) {
    this.wss = null;
    this.clients = new Set();
    this.bleManager = bleManager;
    this.setupBLEListeners();
  }

  setupBLEListeners() {
    // Listen for device updates from BLE manager
    this.bleManager.on('deviceUpdate', (device) => {
      if (!device) return;
      
      const deviceData = {
        id: device.id,
        name: device.name,
        properties: {
          serial: device.serial,
          firmware: device.firmware,
          battery: device.batteryLevel,
          sensor: device.sensorValue,
          pressValue: device.pressValue,
          buttonState: device.buttonState,
          rssi: device.rssi
        },
        connected: device.connected
      };

      this.broadcast({
        type: 'deviceUpdate',
        device: deviceData
      });
    });

    // Listen for device connection/disconnection
    this.bleManager.on('deviceConnected', (device) => {
      const deviceData = {
        id: device.id,
        name: device.name,
        properties: {
          serial: device.serial,
          firmware: device.firmware,
          battery: device.batteryLevel,
          sensor: device.sensorValue,
          pressValue: device.pressValue,
          buttonState: device.buttonState,
          rssi: device.rssi
        },
        connected: true
      };

      this.broadcast({
        type: 'deviceConnected',
        device: deviceData
      });
    });

    this.bleManager.on('deviceDisconnected', (device) => {
      this.broadcast({
        type: 'deviceDisconnected',
        deviceId: device.id
      });
    });

    // Listen for property updates
    this.bleManager.on('propertyUpdate', (data) => {
      this.broadcast({
        type: 'propertyUpdate',
        deviceId: data.deviceId,
        property: data.property,
        value: data.property === 'battery' ? parseInt(data.value) : data.value
      });
    });

    // Listen for button/sensor updates
    this.bleManager.on('buttonUpdate', (data) => {
      // Send both button state and press value updates
      this.broadcast({
        type: 'propertyUpdate',
        deviceId: data.deviceId,
        property: 'buttonState',
        value: data.buttonState
      });

      this.broadcast({
        type: 'propertyUpdate',
        deviceId: data.deviceId,
        property: 'pressValue',
        value: data.pressValue
      });

      // Also send the combined button event
      this.broadcast({
        type: 'buttonEvent',
        deviceId: data.deviceId,
        pressed: data.buttonState === 1,
        value: data.pressValue
      });
    });

    this.bleManager.on('sensorUpdate', (data) => {
      this.broadcast({
        type: 'propertyUpdate',
        deviceId: data.deviceId,
        property: 'sensor',
        value: data.value
      });
    });
  }

  start() {
    this.wss = new WebSocket.Server({ port: 8080 });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log('WebSocket client connected');

      // Send initial device list
      const devices = Array.from(this.bleManager.devices.values()).map(device => ({
        id: device.id,
        name: device.name,
        properties: {
          serial: device.serial,
          firmware: device.firmware,
          battery: device.batteryLevel,
          sensor: device.sensorValue,
          pressValue: device.pressValue,
          buttonState: device.buttonState,
          rssi: device.rssi
        },
        connected: device.connected
      }));

      ws.send(JSON.stringify({
        type: 'devicesList',
        devices: devices
      }));

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error('Error handling message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            error: error.message
          }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('WebSocket client disconnected');
      });
    });
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async handleMessage(ws, data) {
    switch (data.type) {
      case 'setColor':
        await this.bleManager.setColor(data.deviceId, data.color.r, data.color.g, data.color.b, 1);
        break;
      case 'setBrightness':
        await this.bleManager.setBrightness(data.deviceId, data.intensity, 1);
        break;
      default:
        console.warn('Unknown message type:', data.type);
    }
  }
}

module.exports = WSServer;
