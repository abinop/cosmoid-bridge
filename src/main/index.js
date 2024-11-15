// src/main/index.js
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const BLEManager = require('./ble-windows');
const WSServer = require('./ws-server');

let mainWindow;
let tray;
const store = new Store();
const wsServer = new WSServer(BLEManager);

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

  // Forward BLE events to renderer
  BLEManager.on('deviceUpdate', (device) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deviceUpdate', device);
    }
  });

  BLEManager.on('deviceConnected', (device) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deviceConnected', device);
    }
  });

  BLEManager.on('deviceDisconnected', (device) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deviceDisconnected', device);
    }
  });

  // Start BLE scanning when window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    ipcMain.emit('startScanning');
  });
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
ipcMain.on('toggle-auto-launch', async (event, enabled) => {
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

ipcMain.on('hide-window', () => {
  mainWindow.hide();
});

// Handle device control commands
ipcMain.on('setColor', async (event, { deviceId, color }) => {
  try {
    await BLEManager.setColor(deviceId, color.r, color.g, color.b, 1);
  } catch (error) {
    console.error('Failed to set color:', error);
  }
});

ipcMain.on('setLuminosity', async (event, { deviceId, intensity }) => {
  try {
    await BLEManager.setBrightness(deviceId, intensity, 1);
  } catch (error) {
    console.error('Failed to set luminosity:', error);
  }
});

ipcMain.on('requestDevices', (event) => {
  const devices = Array.from(BLEManager.devices.values()).map(device => ({
    id: device.id,
    name: device.name,
    serial: device.serial,
    firmware: device.firmware,
    batteryLevel: device.batteryLevel,
    sensorValue: device.sensorValue,
    pressValue: device.pressValue,
    buttonState: device.buttonState,
    rssi: device.rssi,
    connected: device.connected
  }));
  event.reply('deviceList', devices);
});

ipcMain.on('startScanning', async (event) => {
  try {
    await BLEManager.startScanning();
    event.reply('scanningStarted');
  } catch (error) {
    event.reply('error', {
      message: 'Failed to start scanning',
      error: error.toString()
    });
  }
});

ipcMain.on('stopScanning', async (event) => {
  try {
    await BLEManager.stopScanning();
    event.reply('scanningStopped');
  } catch (error) {
    event.reply('error', {
      message: 'Failed to stop scanning',
      error: error.toString()
    });
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  wsServer.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  BLEManager.stopScanning();
});
