// src/main/index.js
const { app: electronApp, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('./ws-server');
const { BLEServer } = require('./ble-server');
const logger = require('../common/logger');

let mainWindow;
let tray;
const store = new Store();
const bleServer = new BLEServer();

// Create Express app and HTTP server
const expressApp = express();
const server = http.createServer(expressApp);

// Create WebSocket server
const wsServer = new WebSocketServer(server);

// Express middleware and routes
expressApp.use(express.json());
expressApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Health check endpoint
expressApp.get('/health', (req, res) => {
    const devices = bleServer.getAllDevices();
    res.json({ 
        status: 'ok',
        devices: devices.length,
        timestamp: new Date().toISOString()
    });
});

// BLE Event Handlers
bleServer.on('deviceUpdated', (updateData) => {
    logger.log('COSMO_UPDATED', updateData.devices[0].name, updateData);
    wsServer.broadcast(updateData);
});

bleServer.on('deviceConnected', (device) => {
    logger.log('COSMO_CONNECTED', device.name, device);
    wsServer.broadcast({
        devices: bleServer.getAllDevices(),
        deviceInfo: {}
    });
});

bleServer.on('deviceDisconnected', (device) => {
    logger.log('COSMO_DISCONNECTED', device.name, device);
    wsServer.broadcast({
        devices: bleServer.getAllDevices(),
        deviceInfo: {}
    });
});

// Electron Window Management
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

// Initialize app
electronApp.whenReady().then(() => {
    createWindow();
    createTray();
    
    server.listen(8080, 'localhost', () => {
        logger.log('SERVER_START', 'Cosmo Bridge running on port 8080');
        bleServer.startScanning();
    });
});

// Handle window management
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

// Handle IPC messages
require('electron').ipcMain.on('hide-window', () => {
    mainWindow.hide();
});

require('electron').ipcMain.on('toggle-auto-launch', async (event, enabled) => {
    const autoLauncher = new AutoLaunch({
        name: 'Cosmoid Bridge',
        isHidden: true
    });

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

// Cleanup on quit
electronApp.on('will-quit', () => {
    bleServer.stopScanning();
    server.close(() => {
        console.log('Server closed');
    });
});
