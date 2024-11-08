const WS_URL = window.location.hostname === 'localhost' 
    ? 'ws://localhost:8080/ws'  // Development
    : 'wss://your-production-url/ws';  // Production
const MAX_RETRIES = 5;

class WebSocketService {
    constructor() {
        this.retryCount = 0;
        this.connect();
    }

    connect() {
        try {
            console.log(`Attempting to connect to ${WS_URL}`);
            this.ws = new WebSocket(WS_URL);
            this.setupEventHandlers();
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.handleReconnect();
        }
    }

    setupEventHandlers() {
        this.ws.onopen = () => {
            console.log('Connected to Cosmoid Bridge');
            this.retryCount = 0; // Reset retry count on successful connection
            this.ws.send(JSON.stringify({ type: 'getDevices' }));
            
            // Dispatch connection event
            window.dispatchEvent(new CustomEvent('bridge-connected'));
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket Disconnected:', event.code, event.reason);
            
            // Dispatch disconnection event
            window.dispatchEvent(new CustomEvent('bridge-disconnected'));
            
            this.handleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Dispatch message event
                window.dispatchEvent(new CustomEvent('bridge-message', {
                    detail: data
                }));
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };
    }

    handleReconnect() {
        if (this.retryCount < MAX_RETRIES) {
            this.retryCount++;
            const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000); // Exponential backoff with max 10s
            console.log(`Attempting to reconnect (${this.retryCount}/${MAX_RETRIES}) in ${delay}ms...`);
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            console.error('Max reconnection attempts reached');
            window.dispatchEvent(new CustomEvent('bridge-connection-failed'));
        }
    }

    sendMessage(type, data = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
                type,
                ...data
            });
            this.ws.send(message);
            return true;
        }
        console.warn('WebSocket is not connected. Message not sent:', { type, data });
        return false;
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Create and export a singleton instance
const webSocketService = new WebSocketService();
export default webSocketService; 