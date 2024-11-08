// WebSocket server implementation for handling client connections
const WebSocket = require('ws');

class WebSocketServer {
    constructor(server) {
        this.wss = new WebSocket.Server({ 
            server,
            // Add ping-pong heartbeat
            clientTracking: true,
            pingInterval: 30000,
            pingTimeout: 5000
        });

        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws) => {
            console.log('Client connected to WebSocket');

            // Setup heartbeat
            ws.isAlive = true;
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            ws.on('error', (error) => {
                console.error('WebSocket client error:', error);
            });

            ws.on('close', () => {
                console.log('Client disconnected from WebSocket');
            });
        });

        // Implement heartbeat check
        const interval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log('Terminating inactive client');
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping(() => {});
            });
        }, 30000);

        this.wss.on('close', () => {
            clearInterval(interval);
        });
    }

    broadcast(data) {
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }
}

module.exports = { WebSocketServer };
