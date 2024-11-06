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

const isDev = process.argv.includes('--debug') || process.env.NODE_ENV === 'development';

function logError(error) {
  console.error('Detailed error:', {
    message: error.message,
    stack: error.stack,
    code: error.code,
    errno: error.errno
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, '../../assets/icon.png')
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
app.on('ready', async () => {
  try {
    createWindow();
    createTray();
    
    // Initialize BLE before starting WebSocket server
    await initializeBLE();
    
    // Start WebSocket server after BLE is initialized
    await wsServer.start().catch(error => {
      logError(error);
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('bluetooth-error', `WebSocket server failed to start: ${error.message}`);
      });
    });
  } catch (error) {
    logError(error);
    console.error('Failed to initialize application:', error);
    // Don't quit the app, but show error in window
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('initialization-error', error.message);
    });
  }

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

  // Handle retry-bluetooth
  require('electron').ipcMain.on('retry-bluetooth', async (event) => {
    try {
      // Attempt to reinitialize BLE
      await initializeBLE();  // You'll need to implement this
      // If successful, notify the renderer
      event.reply('bluetooth-status', { success: true });
    } catch (error) {
      // If failed, send the error to renderer
      event.reply('bluetooth-error', error.message);
    }
  });
});

// Prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (BrowserWindow.getAllWindows().length) {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
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
}

// Modify your BLE initialization to match the new BLE server implementation
async function initializeBLE() {
  try {
    if (isDev) {
      console.log('Initializing BLE...');
    }
    
    // Instead of calling initialize, we'll wait for the noble state to be ready
    await new Promise((resolve, reject) => {
      if (bleServer.noble && bleServer.noble.state === 'poweredOn') {
        resolve();
      } else {
        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
          reject(new Error('BLE initialization timed out'));
        }, 10000);

        bleServer.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        bleServer.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      }
    });

    if (isDev) {
      console.log('BLE initialized successfully');
    }
  } catch (error) {
    logError(error);
    console.error('BLE initialization failed:', error);
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('bluetooth-error', 
        `BLE initialization failed: ${error.message}\nCode: ${error.code || 'N/A'}`);
    });
    throw error;
  }
}

if (isDev) {
  bleServer.on('deviceDiscovered', (device) => {
    console.log('Device discovered:', device);
  });
  
  bleServer.on('error', (error) => {
    console.error('BLE error:', error);
  });
}
