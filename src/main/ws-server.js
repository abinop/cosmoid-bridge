// WebSocket server implementation for handling client connections
const WebSocket = require('ws');

class WSServer {
  constructor(bleServer) {
    this.bleServer = bleServer;
    this.wss = null;
    this.port = 54545;  // Set default port
    this.clients = new Set();  // Add this to track clients
    
    // Set up BLE event handlers
    this.bleServer.on('deviceFound', (device) => {
      console.log('Broadcasting device found:', device);
      this.broadcast({
        type: 'deviceFound',
        device
      });
    });

    this.bleServer.on('deviceUpdated', (device) => {
      this.broadcast({
        type: 'deviceUpdated',
        device
      });
    });

    this.bleServer.on('deviceConnected', (device) => {
      console.log('Broadcasting device connected:', device);
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
  }

  broadcast(message) {
    console.log('Broadcasting message:', message);
    if (this.wss) {
      this.wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify(message));
          } catch (error) {
            console.error('Failed to send message to client:', error);
          }
        }
      });
    }
  }

  start(initialPort = this.port) {
    return new Promise((resolve, reject) => {
      const tryPort = (port) => {
        console.log(`Attempting to start WebSocket server on port ${port}...`);
        
        try {
          this.wss = new WebSocket.Server({ 
            port: port,
            clientTracking: true
          });

          this.wss.on('listening', () => {
            console.log(`WebSocket server started on port ${port}`);
            this.port = port;
            this.setupConnectionHandlers();
            resolve(port);
          });

          this.wss.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
              console.log(`Port ${port} is in use, trying ${port + 1}...`);
              this.wss.close();
              tryPort(port + 1);
            } else {
              reject(error);
            }
          });
        } catch (error) {
          reject(error);
        }
      };

      tryPort(initialPort);
    });
  }

  setupConnectionHandlers() {
    this.wss.on('connection', (ws) => {
      console.log('New WebSocket client connected');
      this.clients.add(ws);

      // Send current devices list to new client
      const devices = this.bleServer.getAllDevices();
      ws.send(JSON.stringify({
        type: 'devicesList',
        devices
      }));

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          console.log('Received message:', data);
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error('Failed to handle message:', error);
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
      });
    });
  }

  async handleMessage(ws, data) {
    try {
      switch (data.type) {
        case 'scan':
          try {
            await this.bleServer.startScanning();
          } catch (error) {
            console.error('Scanning error:', error);
            ws.send(JSON.stringify({
              type: 'error',
              error: `Failed to start scanning: ${error.message}`
            }));
          }
          break;
        case 'getDevices':
          const devices = this.bleServer.getAllDevices();
          ws.send(JSON.stringify({
            type: 'devicesList',
            devices
          }));
          break;
        case 'connect':
          console.log('Received connect request for device:', data.deviceId);
          try {
            const success = await this.bleServer.connectToDevice(data.deviceId);
            console.log('Connect result:', success);
            ws.send(JSON.stringify({
              type: 'connectResult',
              deviceId: data.deviceId,
              success: success
            }));
          } catch (error) {
            console.error('Connection error:', error);
            ws.send(JSON.stringify({
              type: 'connectResult',
              deviceId: data.deviceId,
              success: false,
              error: error.message
            }));
          }
          break;
        case 'write':
          const writeSuccess = await this.bleServer.writeCharacteristic(
            data.deviceId,
            data.characteristicUUID,
            data.value
          );
          ws.send(JSON.stringify({
            type: 'writeResult',
            deviceId: data.deviceId,
            success: writeSuccess
          }));
          break;
        case 'sendEvent':
          const eventSuccess = await this.bleServer.sendEventToDevice(
            data.deviceId,
            data.eventType,
            data.data
          );
          ws.send(JSON.stringify({
            type: 'eventResult',
            success: eventSuccess,
            originalEvent: data
          }));
          break;
        case 'setColor':
          if (data.deviceId && Array.isArray(data.data)) {
            const eventSuccess = await this.bleServer.sendEventToDevice(
              data.deviceId,
              'setColor',
              data.data
            );
            ws.send(JSON.stringify({
              type: 'eventResult',
              success: eventSuccess,
              originalEvent: data
            }));
          }
          break;
        case 'setLuminosity':
          if (data.deviceId && Array.isArray(data.data)) {
            const eventSuccess = await this.bleServer.sendEventToDevice(
              data.deviceId,
              'setLuminosity',
              data.data
            );
            ws.send(JSON.stringify({
              type: 'eventResult',
              success: eventSuccess,
              originalEvent: data
            }));
          }
          break;
      }
    } catch (error) {
      console.error('Failed to handle message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: `Message handling error: ${error.message}`
      }));
    }
  }

  stop() {
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = { WSServer };
