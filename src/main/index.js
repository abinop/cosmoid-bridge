// src/main/index.js
const { app: electronApp, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const express = require('express');
const { WSServer } = require('./ws-server');
const { bleServer } = require('./ble-server');
const logger = require('../common/logger');

let mainWindow;
let tray;
const store = new Store();

// Create Express app and HTTP server
const expressApp = express();

// Create WebSocket server instance
const wsServer = new WSServer(bleServer);

// Express middleware and routes
expressApp.use(express.json());
expressApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static files for WebSocket client
expressApp.use('/ws', express.static(path.join(__dirname, '../renderer')));

// Health check endpoint
expressApp.get('/health', (req, res) => {
    const devices = bleServer.getAllDevices();
    res.json({ 
        status: 'ok',
        devices: devices.length,
        timestamp: new Date().toISOString()
    });
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        crashReporter: {
            start: false
        },
        enableCrashReporter: false
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    bleServer.initialize(mainWindow);
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
    
    // Initialize WebSocket server directly
    wsServer.initialize();
    
    // Start Express app separately if needed
    expressApp.listen(3000, 'localhost', () => {
        console.log('HTTP Server running on port 3000');
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

// Cleanup on quit
electronApp.on('will-quit', () => {
    bleServer.stopScanning();
    if (wsServer.wss) {
        wsServer.wss.close(() => {
            console.log('WebSocket Server closed');
        });
    }
});

module.exports = { expressApp };
