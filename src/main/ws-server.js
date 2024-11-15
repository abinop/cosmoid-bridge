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
      console.log('****Device update received:', device);
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
    this.bleManager.on('deviceConnected', (device) => {
      console.log('****Device connected:', device);
      this.broadcast({
        type: 'deviceConnected',
        device: {
          id: device.id,
          name: device.name,
          serial: device.serial,
          firmware: device.firmware,
          batteryLevel: device.batteryLevel
        }
      });
    });

    this.bleManager.on('deviceDisconnected', (device) => {
      console.log('****Device disconnected:', device);
      this.broadcast({
        type: 'deviceDisconnected',
        device: {
          id: device.id,
          name: device.name
        }
      });
    });

    // Listen for property updates
    this.bleManager.on('propertyUpdate', (data) => {
      console.log('****Property update received:', data);
      this.broadcast({
        type: 'propertyUpdate',
        deviceId: data.deviceId,
        property: data.property,
        value: data.value
      });
    });

    // Listen for button/sensor updates
    this.bleManager.on('buttonUpdate', (data) => {
      console.log('****Button update received:', data);
      this.broadcast({
        type: 'buttonEvent',
        deviceId: data.deviceId,
        state: data.buttonState,
        force: data.pressValue
      });
    });

    this.bleManager.on('sensorUpdate', (data) => {
      console.log('****Sensor update received:', data);
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
      console.log('****WebSocket: New client connected, total clients:', this.clients.size);

      // Send initial device list
      const devices = Array.from(this.bleManager.devices.values()).map(device => {
        console.log('****WebSocket: Sending initial device data:', {
          id: device.id,
          name: device.name,
          connected: device.connected,
          serial: device.serial,
          firmware: device.firmware,
          batteryLevel: device.batteryLevel,
          pressValue: device.pressValue
        });
        return ({
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
        });
      });
      ws.send(JSON.stringify({ type: 'devicesList', devices }));

      ws.on('message', async (message) => {
        console.log('****WebSocket: Received message:', message.toString());
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
        console.log('****WebSocket: Client disconnected, remaining clients:', this.clients.size);
      });
    });

    console.log('****WebSocket: Server started on port 8080');
  }

  async handleMessage(ws, message) {
    console.log('Received WebSocket message:', message);

    switch (message.type) {
      case 'scan':
        await this.bleManager.startScanning();
        break;

      case 'getDevices':
        const devices = Array.from(this.bleManager.devices.values()).map(device => ({
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
          await this.bleManager.setColor(deviceId, r, g, b, 1);
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
          await this.bleManager.setBrightness(deviceId, intensity, 1);
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
    console.log('****WebSocket Broadcasting:', {
      type: message.type,
      data: message
    });
    const data = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }
}

module.exports = WSServer;
