// Renderer process code
const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
  const autoLaunchCheckbox = document.getElementById('autoLaunch');
  const hideWindowButton = document.getElementById('hideWindow');
  const devicesList = document.getElementById('devicesList');

  // Setup auto-launch checkbox
  autoLaunchCheckbox.addEventListener('change', (e) => {
    ipcRenderer.send('toggle-auto-launch', e.target.checked);
  });

  // Setup hide window button
  hideWindowButton.addEventListener('click', () => {
    ipcRenderer.send('hide-window');
  });

  // Device handling
  const devices = new Map();

  ipcRenderer.on('deviceUpdate', (event, device) => {
    if (!device || !device.id) return;
    devices.set(device.id, device);
    updateDeviceList();
  });

  ipcRenderer.on('deviceConnected', (event, device) => {
    if (!device || !device.id) return;
    devices.set(device.id, device);
    updateDeviceList();
  });

  ipcRenderer.on('deviceDisconnected', (event, device) => {
    if (!device || !device.id) return;
    devices.delete(device.id);
    updateDeviceList();
  });

  ipcRenderer.on('deviceList', (event, deviceList) => {
    devices.clear();
    deviceList.forEach(device => {
      if (device && device.id) {
        devices.set(device.id, device);
      }
    });
    updateDeviceList();
  });

  function updateDeviceList() {
    const deviceListEl = document.getElementById('devicesList');
    deviceListEl.innerHTML = '';

    devices.forEach(device => {
      const deviceEl = document.createElement('div');
      deviceEl.className = 'device';
      deviceEl.innerHTML = `
        <div class="device-header">
          <span class="device-name">${device.name || 'Unknown Device'}</span>
          <span class="device-status ${device.connected ? 'connected' : 'disconnected'}">
            ${device.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div class="device-info">
          <div>Serial: ${device.serial || 'N/A'}</div>
          <div>Firmware: ${device.firmware || 'N/A'}</div>
          <div>Battery: ${device.batteryLevel !== null ? device.batteryLevel + '%' : 'N/A'}</div>
          <div>Sensor: ${device.sensorValue !== undefined ? device.sensorValue : 'N/A'}</div>
          <div>Button: ${device.buttonState ? 'Pressed' : 'Released'}</div>
          <div>Press Value: ${device.pressValue !== undefined ? device.pressValue : 'N/A'}</div>
          <div>RSSI: ${device.rssi !== undefined ? device.rssi + ' dBm' : 'N/A'}</div>
        </div>
        <div class="device-controls">
          ${device.connected ? `
            <button class="button" onclick="window.setRandomLuminosity('${device.id}')">Random Brightness</button>
            <button class="button" onclick="window.setRandomColor('${device.id}')">Random Color</button>
          ` : ''}
        </div>
      `;
      deviceListEl.appendChild(deviceEl);
    });
  }

  // Request initial device list
  ipcRenderer.send('getDevices');

  // Make functions available to onclick handlers
  window.setRandomLuminosity = (deviceId) => {
    const intensity = Math.floor(Math.random() * 64);
    ipcRenderer.send('setLuminosity', { deviceId, intensity });
  };

  window.setRandomColor = (deviceId) => {
    const color = {
      r: Math.floor(Math.random() * 3),
      g: Math.floor(Math.random() * 3),
      b: Math.floor(Math.random() * 3)
    };
    ipcRenderer.send('setColor', { deviceId, color });
  };
});
