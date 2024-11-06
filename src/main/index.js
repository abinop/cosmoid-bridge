// src/main/index.js
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const { BLEServer } = require('./ble-server');
const { WSServer } = require('./ws-server');

let mainWindow;
let tray;
const store = new Store();
let bleServer;
let wsServer;

const isDev = process.argv.includes('--debug');

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
  
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

async function initializeServices() {
  try {
    console.log('Initializing BLE server...');
    bleServer = new BLEServer();
    
    // Wait for BLE server to be ready
    await new Promise((resolve, reject) => {
      bleServer.once('ready', resolve);
      bleServer.once('error', reject);
      // Add timeout
      setTimeout(() => reject(new Error('BLE initialization timeout')), 10000);
    });
    
    console.log('BLE server initialized');

    console.log('Initializing WebSocket server...');
    wsServer = new WSServer(bleServer);
    await wsServer.start();
    console.log('WebSocket server initialized');

    return true;
  } catch (error) {
    console.error('Failed to initialize services:', error);
    return false;
  }
}

app.whenReady().then(async () => {
  try {
    const success = await initializeServices();
    if (!success) {
      console.error('Failed to initialize services');
      app.quit();
      return;
    }

    createWindow();
    
    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    console.error('Startup error:', error);
    app.quit();
  }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (wsServer) {
    wsServer.stop();
  }
});

// Handle IPC messages
require('electron').ipcMain.on('get-devices', (event) => {
  if (bleServer) {
    event.reply('devices-list', bleServer.getAllDevices());
  }
});

if (isDev) {
  bleServer.on('deviceDiscovered', (device) => {
    console.log('Device discovered:', device);
  });
  
  bleServer.on('error', (error) => {
    console.error('BLE error:', error);
  });
}
