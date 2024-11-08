// src/main/index.js
const { app: electronApp, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const { BLEServer } = require('./ble-server');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

let mainWindow;
let tray;
const store = new Store();
const bleServer = new BLEServer();
const expressApp = express();
const server = http.createServer(expressApp);
const wss = new WebSocket.Server({ server });

// Create auto launcher
const autoLauncher = new AutoLaunch({
  name: 'Cosmoid Bridge',
  isHidden: true
});

// Express middleware
expressApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// WebSocket connection handling
wss.on('connection', (ws) => {
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

    // Send initial device list
    const devices = bleServer.getAllDevices();
    console.log('Sending initial device list:', devices);
    ws.send(JSON.stringify({
        type: 'deviceList',
        devices: devices
    }));

    // Handle incoming messages from web client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message from client:', data);
            
            // Handle different message types
            switch(data.type) {
                case 'getDevices':
                    ws.send(JSON.stringify({
                        type: 'deviceList',
                        devices: bleServer.getAllDevices()
                    }));
                    break;
                // Add other message handlers as needed
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
});

// Heartbeat interval
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Initialize auto-launch checkbox state
    const autoLaunchEnabled = store.get('autoLaunch', false);
    if (autoLaunchEnabled) {
        autoLauncher.enable();
    }
}

function createTray() {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.png'));
    tray = new Tray(icon);
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        { label: 'Quit', click: () => electronApp.quit() }
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.setToolTip('Cosmoid Bridge');
}

// IPC handlers
electronApp.on('ready', () => {
    // Handle auto-launch toggle
    require('electron').ipcMain.on('toggle-auto-launch', async (event, enabled) => {
        try {
            if (enabled) {
                await autoLauncher.enable();
            } else {
                await autoLauncher.disable();
            }
            store.set('autoLaunch', enabled);
        } catch (error) {
            console.error('Failed to toggle auto-launch:', error);
        }
    });

    // Handle window hide
    require('electron').ipcMain.on('hide-window', () => {
        mainWindow.hide();
    });
});

electronApp.whenReady().then(() => {
    createWindow();
    createTray();
    
    // Start the server
    server.listen(8080, () => {
        console.log('Server is running on port 8080');
        // Start BLE scanning after server is ready
        bleServer.startScanning();
    });
});

electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electronApp.quit();
    }
});

electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Broadcast to all connected WebSocket clients
function broadcast(data) {
    console.log('Broadcasting to clients:', data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Enhanced BLE event listeners
bleServer.on('deviceDiscovered', (device) => {
    console.log('Device discovered, broadcasting:', device);
    broadcast({
        type: 'deviceDiscovered',
        device: device
    });
});

bleServer.on('deviceConnected', (device) => {
    console.log('Device connected, broadcasting:', device);
    broadcast({
        type: 'deviceConnected',
        device: device
    });
    
    // Also send updated device list
    broadcast({
        type: 'deviceList',
        devices: bleServer.getAllDevices()
    });
});

bleServer.on('deviceDisconnected', (device) => {
    console.log('Device disconnected, broadcasting:', device);
    broadcast({
        type: 'deviceDisconnected',
        device: device
    });
    
    // Also send updated device list
    broadcast({
        type: 'deviceList',
        devices: bleServer.getAllDevices()
    });
});

bleServer.on('deviceUpdated', (updateData) => {
    console.log('Device updated, broadcasting:', updateData);
    broadcast({
        type: 'deviceUpdated',
        ...updateData
    });
});
