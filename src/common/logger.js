const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../../../__help/logs');
        this.logFile = path.join(this.logDir, 'bridge.log');

        // Ensure logs directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        // Clear existing log file
        fs.writeFileSync(this.logFile, '');
    }

    log(type, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            type,
            message,
            data
        };

        // Write to file
        fs.appendFileSync(this.logFile, JSON.stringify(logEntry, null, 2) + '\n');

        // Minimal console output for important events
        switch(type) {
            case 'COSMO_CONNECTED':
                console.log('🟢 Cosmo connected:', message);
                break;
            case 'COSMO_DISCONNECTED':
                console.log('🔴 Cosmo disconnected:', message);
                break;
            case 'COSMO_UPDATED':
                console.log('🔵 Cosmo updated:', message);
                break;
            case 'WS_ERROR':
                console.error('❌ WebSocket error:', message);
                break;
            case 'WS_CONNECTION':
                console.log('🌐 WebSocket:', message);
                break;
            case 'WS_BROADCAST':
                // Only log the device count for broadcasts
                if (data?.devices) {
                    console.log(`📡 Broadcasting: ${data.devices.length} devices`);
                }
                break;
        }
    }
}

module.exports = new Logger(); 