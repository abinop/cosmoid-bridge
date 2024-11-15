const WebSocket = require('ws');
const BLEManager = require('./ble-windows');

class WSServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.setupBLEListeners();
  }

  setupBLEListeners() {
    // Listen for device updates from BLE manager
    BLEManager.on('deviceUpdate', (device) => {
      this.broadcast({
        type: 'deviceUpdate',
        device: {
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
        }
      });
    });

    // Listen for device connection/disconnection
    BLEManager.on('deviceConnected', (device) => {
      this.broadcast({
        type: 'deviceConnected',
        device: {
          id: device.id,
          name: device.name
        }
      });
    });

    BLEManager.on('deviceDisconnected', (device) => {
      this.broadcast({
        type: 'deviceDisconnected',
        device: {
          id: device.id,
          name: device.name
        }
      });
    });

    // Listen for button/sensor updates
    BLEManager.on('buttonUpdate', (data) => {
      this.broadcast({
        type: 'buttonEvent',
        deviceId: data.deviceId,
        state: data.buttonState,
        force: data.pressValue
      });
    });

    BLEManager.on('sensorUpdate', (data) => {
      this.broadcast({
        type: 'sensorEvent',
        deviceId: data.deviceId,
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
      const devices = Array.from(BLEManager.devices.values()).map(device => ({
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
      ws.send(JSON.stringify({ type: 'devicesList', devices }));

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

    console.log('WebSocket server started on port 8080');
  }

  async handleMessage(ws, message) {
    console.log('Received WebSocket message:', message);

    switch (message.type) {
      case 'scan':
        await BLEManager.startScanning();
        break;

      case 'getDevices':
        const devices = Array.from(BLEManager.devices.values()).map(device => ({
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
        ws.send(JSON.stringify({ type: 'devicesList', devices }));
        break;

      case 'setColor':
        try {
          const { deviceId, data } = message;
          const [r, g, b] = data;
          await BLEManager.setColor(deviceId, r, g, b, 1);
          ws.send(JSON.stringify({
            type: 'eventResult',
            success: true,
            event: 'setColor'
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'eventResult',
            success: false,
            error: error.message,
            event: 'setColor'
          }));
        }
        break;

      case 'setLuminosity':
        try {
          const { deviceId, data } = message;
          const [intensity] = data;
          await BLEManager.setBrightness(deviceId, intensity, 1);
          ws.send(JSON.stringify({
            type: 'eventResult',
            success: true,
            event: 'setLuminosity'
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'eventResult',
            success: false,
            error: error.message,
            event: 'setLuminosity'
          }));
        }
        break;

      default:
        console.warn('Unknown message type:', message.type);
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`
        }));
    }
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }
}

module.exports = WSServer;
