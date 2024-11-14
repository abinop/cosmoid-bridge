const WebSocket = require('ws');

class WSServer {
  constructor(bleServer) {
    this.bleServer = bleServer;
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    this.wss = new WebSocket.Server({ port: 8080 });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error('Error handling message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  async handleMessage(ws, message) {
    switch (message.type) {
      case 'scan':
        await this.bleServer.startScanning();
        break;
      case 'getDevices':
        const devices = await this.bleServer.getDevices();
        ws.send(JSON.stringify({ type: 'devicesList', devices }));
        break;
      // Add other message handlers as needed
    }
  }

  broadcast(message) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
}

module.exports = WSServer;
