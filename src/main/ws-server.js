// WebSocket server implementation for handling client connections
const WebSocket = require('ws');

class WSServer {
  constructor(bleServer) {
    this.server = null;
    this.clients = new Set();
    this.bleServer = bleServer;
    
    // Listen to BLE events
    this.setupBLEListeners();
  }

  setupBLEListeners() {
    // Generic event handler
    this.bleServer.on('event', (event) => {
      this.broadcast({
        type: 'event',
        event
      });
    });

    // Specific event handlers
    this.bleServer.on('deviceDiscovered', (device) => {
      this.broadcast({
        type: 'deviceFound',
        device
      });
    });

    this.bleServer.on('deviceConnected', (device) => {
      this.broadcast({
        type: 'deviceConnected',
        device
      });
    });

    this.bleServer.on('deviceDisconnected', (device) => {
      console.log('Broadcasting device disconnected:', device);
      this.broadcast({
        type: 'deviceDisconnected',
        device
      });
    });

    this.bleServer.on('characteristicChanged', (data) => {
      this.broadcast({
        type: 'characteristicChanged',
        ...data
      });
    });
  }

  start(port = 8080) {
    this.server = new WebSocket.Server({ port });
    
    this.server.on('connection', (ws) => {
      this.clients.add(ws);
      
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error('Failed to handle message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  async handleMessage(ws, message) {
    switch(message.type) {
      case 'scan':
        this.bleServer.startScanning();
        break;
      
      case 'getDevices':
        const devices = this.bleServer.getAllDevices();
        ws.send(JSON.stringify({
          type: 'devicesList',
          devices
        }));
        break;
      
      case 'connect':
        const success = await this.bleServer.connectToDevice(message.deviceId);
        ws.send(JSON.stringify({
          type: 'connectResult',
          deviceId: message.deviceId,
          success
        }));
        break;
      
      case 'write':
        const writeSuccess = await this.bleServer.writeCharacteristic(
          message.deviceId,
          message.characteristicUUID,
          message.value
        );
        ws.send(JSON.stringify({
          type: 'writeResult',
          deviceId: message.deviceId,
          success: writeSuccess
        }));
        break;
      
      case 'sendEvent':
        const eventSuccess = await this.bleServer.sendEventToDevice(
          message.deviceId,
          message.eventType,
          message.data
        );
        ws.send(JSON.stringify({
          type: 'eventResult',
          success: eventSuccess,
          originalEvent: message
        }));
        break;

      case 'setColor':
        if (message.deviceId && Array.isArray(message.data)) {
          const eventSuccess = await this.bleServer.sendEventToDevice(
            message.deviceId,
            'setColor',
            message.data
          );
          ws.send(JSON.stringify({
            type: 'eventResult',
            success: eventSuccess,
            originalEvent: message
          }));
        }
        break;

      case 'setLuminosity':
        if (message.deviceId && Array.isArray(message.data)) {
          const eventSuccess = await this.bleServer.sendEventToDevice(
            message.deviceId,
            'setLuminosity',
            message.data
          );
          ws.send(JSON.stringify({
            type: 'eventResult',
            success: eventSuccess,
            originalEvent: message
          }));
        }
        break;
    }
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { WSServer };
