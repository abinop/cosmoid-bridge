const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

class WSServer {
  constructor(bleManager) {
    this.wss = null;
    this.clients = new Set();
    this.bleManager = bleManager;
    
    // Set up logging
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : '/var/local');
    this.logPath = path.join(appDataPath, 'Cosmoid Bridge', 'websocket.log');
    
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    this.setupBLEListeners();
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
    console.log(logMessage);
    fs.appendFileSync(this.logPath, logMessage);
  }

  setupBLEListeners() {
    // Listen for device updates from BLE manager
    this.bleManager.on('deviceUpdate', (device) => {
      this.log('****BLE->WS: Device update received:', {
        id: device.id,
        name: device.name,
        connected: device.connected,
        serial: device.serial,
        firmware: device.firmware,
        batteryLevel: device.batteryLevel,
        pressValue: device.pressValue
      });
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
      this.log('****BLE->WS: Device connected:', {
        id: device.id,
        name: device.name,
        serial: device.serial,
        firmware: device.firmware,
        batteryLevel: device.batteryLevel
      });
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
      this.log('****BLE->WS: Device disconnected:', {
        id: device.id,
        name: device.name
      });
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
      this.log('****BLE->WS: Property update:', {
        deviceId: data.deviceId,
        property: data.property,
        value: data.value
      });
      this.broadcast({
        type: 'propertyUpdate',
        deviceId: data.deviceId,
        property: data.property,
        value: data.value
      });
    });

    // Listen for button/sensor updates
    this.bleManager.on('buttonUpdate', (data) => {
      this.log('****BLE->WS: Button update:', {
        deviceId: data.deviceId,
        buttonState: data.buttonState,
        pressValue: data.pressValue
      });
      this.broadcast({
        type: 'buttonEvent',
        deviceId: data.deviceId,
        state: data.buttonState,
        force: data.pressValue
      });
    });

    this.bleManager.on('sensorUpdate', (data) => {
      this.log('****BLE->WS: Sensor update:', {
        deviceId: data.deviceId,
        value: data.value
      });
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
      this.log('****WebSocket: New client connected, total clients:', this.clients.size);

      // Send initial device list
      const devices = Array.from(this.bleManager.devices.values()).map(device => {
        this.log('****WebSocket: Sending initial device data:', {
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
        this.log('****WebSocket: Received message:', message.toString());
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, data);
        } catch (error) {
          this.log('Error handling message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            error: error.message
          }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.log('****WebSocket: Client disconnected, remaining clients:', this.clients.size);
      });
    });

    this.log('****WebSocket: Server started on port 8080');
  }

  async handleMessage(ws, message) {
    this.log('Received WebSocket message:', message);

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
        this.log('Unknown message type:', message.type);
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`
        }));
    }
  }

  broadcast(message) {
    this.log('****WS->Clients: Broadcasting:', {
      type: message.type,
      payload: message
    });
    const data = JSON.stringify(message);
    let sentCount = 0;
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        sentCount++;
      }
    });
    this.log('****WS->Clients: Broadcast complete:', {
      sentTo: sentCount,
      totalClients: this.clients.size
    });
  }
}

module.exports = WSServer;
