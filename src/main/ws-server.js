// WebSocket server implementation for handling client connections
const WebSocket = require('ws');
const logger = require('../common/logger');

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
            logger.log('WS_CONNECTION', 'New client connected');

            // Setup heartbeat
            ws.isAlive = true;
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            // Handle incoming messages
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    logger.log('WS_MESSAGE', 'Received message', data);
                    
                    // Handle getDevices request
                    if (data.type === 'getDevices') {
                        // Trigger a device list update if needed
                        // You might need to call your BLE server's method here
                    }
                } catch (error) {
                    logger.log('WS_ERROR', 'Error processing message', error);
                }
            });

            ws.on('error', (error) => {
                logger.log('WS_ERROR', 'WebSocket client error', error);
            });

            ws.on('close', () => {
                logger.log('WS_DISCONNECT', 'Client disconnected');
            });
        });

        // Implement heartbeat check
        const interval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    logger.log('WS_TIMEOUT', 'Terminating inactive client');
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
        // Ensure the message has the required 'type' field
        const message = {
            type: 'devicesList',  // This is crucial for the web client
            ...data
        };

        logger.log('WS_BROADCAST', 'Broadcasting message', message);

        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

module.exports = { WebSocketServer };
