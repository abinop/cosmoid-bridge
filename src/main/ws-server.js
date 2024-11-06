// WebSocket server implementation for handling client connections
const WebSocket = require('ws');

class WSServer {
  constructor(bleServer) {
    this.bleServer = bleServer;
    this.wss = null;
    this.port = 54545;
    this.clients = new Set();
    
    // Set up BLE event handlers
    this.bleServer.on('deviceFound', (device) => {
      console.log('Broadcasting device found:', device);
      this.broadcast({
        type: 'deviceFound',
        device
      });
    });

    this.bleServer.on('deviceUpdated', (device) => {
      console.log('Broadcasting device update:', device);
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
    if (!this.wss) {
      console.warn('WebSocket server not initialized');
      return;
    }
    
    console.log('Broadcasting message:', message);
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

  start() {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Starting WebSocket server on port ${this.port}`);
        
        this.wss = new WebSocket.Server({ 
          port: this.port,
          clientTracking: true
        }, () => {
          console.log('WebSocket server started successfully');
          this.setupConnectionHandlers();
          resolve(this.port);
        });

        this.wss.on('error', (error) => {
          console.error('WebSocket server error:', error);
          reject(error);
        });
      } catch (error) {
        console.error('Failed to start WebSocket server:', error);
        reject(error);
      }
    });
  }

  setupConnectionHandlers() {
    if (!this.wss) {
      console.error('WebSocket server not initialized');
      return;
    }

    this.wss.on('connection', (ws, req) => {
      console.log('New WebSocket client connected from:', req.connection.remoteAddress);
      this.clients.add(ws);

      // Send current devices list to new client
      const devices = this.bleServer.getAllDevices();
      console.log('Sending initial devices list:', devices);
      
      try {
        ws.send(JSON.stringify({
          type: 'devicesList',
          devices
        }));
      } catch (error) {
        console.error('Failed to send initial devices list:', error);
      }

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          console.log('Received WebSocket message:', data);
          
          if (data.type === 'scan') {
            console.log('Scan requested, checking BLE state...');
            if (this.bleServer.noble.state === 'poweredOn') {
              console.log('BLE is powered on, starting scan');
              await this.bleServer.startScanning();
            } else {
              console.log('BLE is not ready, state:', this.bleServer.noble.state);
              ws.send(JSON.stringify({
                type: 'error',
                error: `Bluetooth is not ready (state: ${this.bleServer.noble.state})`
              }));
            }
          } else {
            await this.handleMessage(ws, data);
          }
        } catch (error) {
          console.error('Failed to handle message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            error: error.message
          }));
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket client error:', error);
      });
    });
  }

  async handleMessage(ws, data) {
    console.log('Handling message:', data);
    try {
      switch (data.type) {
        case 'scan':
          console.log('Starting BLE scan...');
          await this.bleServer.startScanning();
          break;

        case 'getDevices':
          const devices = this.bleServer.getAllDevices();
          console.log('Sending devices list:', devices);
          ws.send(JSON.stringify({
            type: 'devicesList',
            devices
          }));
          break;

        case 'connect':
          console.log('Connecting to device:', data.deviceId);
          try {
            const success = await this.bleServer.connectToDevice(data.deviceId);
            ws.send(JSON.stringify({
              type: 'connectResult',
              deviceId: data.deviceId,
              success
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

        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  }

  stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

module.exports = { WSServer };
