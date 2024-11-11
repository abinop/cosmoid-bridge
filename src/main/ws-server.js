const WebSocket = require('ws');
const EventEmitter = require('events');

class WSServer extends EventEmitter {
  constructor(bleServer) {
    super();
    this.bleServer = bleServer;
    this.wss = null;
    this.clients = new Set();
  }

  initialize() {
    // Try to close any existing server
    if (this.wss) {
      try {
        this.wss.close();
      } catch (err) {
        console.error('Error closing existing WebSocket server:', err);
      }
    }

    // Create new server with more permissive options
    this.wss = new WebSocket.Server({
      port: 8080,
      host: 'localhost', // Changed from 0.0.0.0 to localhost
      perMessageDeflate: false,
      clientTracking: true,
      backlog: 100,
      handleProtocols: () => 'cosmoid-protocol' // Add protocol support
    });

    console.log('WebSocket server listening on ws://localhost:8080');

    this.wss.on('listening', () => {
      console.log('WebSocket server is now listening');
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
      // Try to restart server on error
      setTimeout(() => {
        console.log('Attempting to restart WebSocket server...');
        this.initialize();
      }, 5000);
    });

    this.wss.on('connection', (ws, req) => {
      console.log('New WebSocket client connected from:', req.socket.remoteAddress);
      this.clients.add(ws);

      // Send initial connected message
      this.sendMessage(ws, { 
        type: 'connected',
        message: 'Successfully connected to Cosmoid Bridge'
      });

      // Get and send current connected devices
      const connectedDevices = this.bleServer.getConnectedDevices();
      console.log('Sending initial device list:', connectedDevices);
      this.sendMessage(ws, {
        type: 'devicesList',
        devices: connectedDevices
      });

      ws.on('message', (message) => {
        console.log('Received message:', message.toString());
        this.handleMessage(ws, message);
      });

      ws.on('close', (code, reason) => {
        console.log('WebSocket client disconnected:', code, reason);
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket client error:', error);
        this.clients.delete(ws);
      });

      // Set up ping-pong to keep connection alive
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
    });

    // Set up ping interval to keep connections alive
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
      });
    }, 30000);

    // Listen for BLE server events
    this.bleServer.removeAllListeners();  // Clear any existing listeners
    
    this.bleServer.on('deviceUpdated', (data) => {
      console.log('Device update received:', data);
      if (data.devices && data.devices.length > 0) {
        this.broadcast(data);
      }
    });

    this.bleServer.on('deviceConnected', (device) => {
      console.log('Device connected:', device);
      this.broadcast({
        type: 'deviceConnected',
        device
      });
      // Also send updated device list
      const devices = this.bleServer.getConnectedDevices();
      this.broadcast({
        type: 'devicesList',
        devices
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

  sendMessage(ws, data) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify(data);
        console.log('Sending message:', message);
        ws.send(message);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  broadcast(data) {
    if (!data) return;
    console.log('Broadcasting to clients:', data);
    for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
            this.sendMessage(client, data);
        }
    }
  }

  handleMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'getDevices':
          this.sendMessage(ws, {
            type: 'devicesList',
            devices: this.bleServer.getAllDevices()
          });
          break;

        case 'getDeviceInfo':
          if (!data.deviceId) {
            this.sendError(ws, 'deviceId is required');
            return;
          }
          break;

        case 'subscribe':
          if (!data.deviceId || !data.characteristicUUID) {
            this.sendError(ws, 'deviceId and characteristicUUID are required');
            return;
          }
          break;

        case 'setColor':
          if (!data.deviceId || !Array.isArray(data.data) || data.data.length !== 3) {
            this.sendError(ws, 'Invalid color data');
            return;
          }
          const rgb = data.data.map(v => Math.max(0, Math.min(4, v)));
          this.bleServer.setColor(data.deviceId, rgb);
          break;

        case 'setLuminosity':
          if (!data.deviceId || !Array.isArray(data.data) || data.data.length !== 1) {
            this.sendError(ws, 'Invalid luminosity data');
            return;
          }
          const luminosity = Math.max(5, Math.min(64, data.data[0]));
          this.bleServer.setLuminosity(data.deviceId, luminosity);
          break;

        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      this.sendError(ws, 'Invalid message format');
    }
  }

  sendError(ws, message) {
    this.sendMessage(ws, {
      type: 'error',
      message
    });
  }

  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = { WSServer };
