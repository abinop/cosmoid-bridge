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
const bleServer = new BLEServer();
const wsServer = new WSServer(bleServer);

// Create auto launcher
const autoLauncher = new AutoLaunch({
  name: 'Cosmoid Bridge',
  isHidden: true
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
    { label: 'Quit', click: () => app.quit() }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.setToolTip('Cosmoid Bridge');
}

// IPC handlers
app.on('ready', () => {
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

app.whenReady().then(() => {
  createWindow();
  createTray();
  wsServer.start();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
