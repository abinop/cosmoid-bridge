const WebSocket = require('ws');

class WSServer {
  constructor(bleManager) {
    this.wss = null;
    this.bleManager = bleManager;
    this.clients = new Set();

    // Bind event handlers
    this.handleConnection = this.handleConnection.bind(this);
    this.handleDeviceUpdate = this.handleDeviceUpdate.bind(this);
    this.handleDeviceDisconnected = this.handleDeviceDisconnected.bind(this);
    this.handleButtonEvent = this.handleButtonEvent.bind(this);

    // Register BLE event handlers
    this.bleManager.on('deviceConnected', this.handleDeviceUpdate);
    this.bleManager.on('deviceDisconnected', this.handleDeviceDisconnected);
    this.bleManager.on('deviceUpdate', this.handleDeviceUpdate);
    this.bleManager.on('buttonEvent', this.handleButtonEvent);
  }

  start() {
    this.wss = new WebSocket.Server({ port: 8080 });

    this.wss.on('connection', this.handleConnection);
  }

  broadcast(message) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  handleConnection(ws) {
    this.clients.add(ws);
    console.log('WebSocket client connected');

    // Send initial device list
    const devices = Array.from(this.bleManager.devices.values()).map(device => ({
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

    ws.send(JSON.stringify({
      type: 'deviceList',
      devices
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
  }

  handleDeviceUpdate(device) {
    this.broadcast({
      type: 'deviceUpdate',
      device: {
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
      }
    });
  }

  handleDeviceDisconnected(device) {
    this.broadcast({
      type: 'deviceDisconnected',
      device: {
        id: device.id,
        name: device.name
      }
    });
  }

  handleButtonEvent(event) {
    this.broadcast({
      type: 'buttonEvent',
      deviceId: event.deviceId,
      pressed: event.pressed,
      value: event.value
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
