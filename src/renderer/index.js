// Renderer process code
const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
  const autoLaunchCheckbox = document.getElementById('autoLaunch');
  const hideWindowButton = document.getElementById('hideWindow');
  const devicesList = document.getElementById('devicesList');

  // Setup auto-launch checkbox
  autoLaunchCheckbox.addEventListener('change', (e) => {
    console.log('Auto-launch checkbox changed:', e.target.checked);
    ipcRenderer.send('toggle-auto-launch', e.target.checked);
  });

  // Setup hide window button
  hideWindowButton.addEventListener('click', () => {
    ipcRenderer.send('hide-window');
  });

  // Handle device updates from IPC
  ipcRenderer.on('deviceUpdate', (event, device) => {
    console.log('Device update received:', device);
    updateDeviceInList(device);
  });

  ipcRenderer.on('deviceList', (event, devices) => {
    console.log('Device list received:', devices);
    updateDevicesList(devices);
  });

  // // Handle device connection events from IPC
  // ipcRenderer.on('deviceConnected', (event, device) => {
  //   console.log('Device connected:', device);
  //   updateDeviceInList(device);
  // });

  // Handle device disconnection events from IPC 
  ipcRenderer.on('deviceDisconnected', (event, device) => {
    console.log('Device disconnected:', device);
    const deviceElement = document.querySelector(`[data-device-id="${device.id}"]`);
    if (deviceElement) {
      deviceElement.remove();
    }
  });

  // Request initial device list
  ipcRenderer.send('requestDevices');

  function updateDeviceInList(device) {
    let deviceElement = document.querySelector(`[data-device-id="${device.id}"]`);
    
    if (!device.connected && deviceElement) {
      deviceElement.remove();
      return;
    }

    const deviceHtml = `
      <div class="device-info-container">
        <span class="status-indicator ${device.connected ? 'connected' : ''}">${device.connected ? '🟢' : '⚪️'}</span>
        <span class="device-name">${device.name || 'Unknown Device'}</span>
        ${device.serial ? `<span class="device-info">Serial: ${device.serial}</span>` : ''}
        ${device.firmware ? `<span class="device-info">Firmware: ${device.firmware}</span>` : ''}
        ${device.batteryLevel !== null ? `<span class="device-info">Battery: ${device.batteryLevel}%</span>` : ''}
        ${device.sensorValue !== undefined ? `<span class="device-info">Sensor: ${device.sensorValue}</span>` : ''}
        ${device.pressValue !== undefined ? `<span class="device-info">Press: ${device.pressValue}</span>` : ''}
      </div>
      <div class="device-controls">
        ${device.connected ? `
          <button class="button" onclick="window.setRandomLuminosity('${device.id}')">Random Brightness</button>
          <button class="button" onclick="window.setRandomColor('${device.id}')">Random Color</button>
        ` : ''}
      </div>
    `;

    if (deviceElement) {
      deviceElement.innerHTML = deviceHtml;
    } else {
      deviceElement = document.createElement('div');
      deviceElement.className = 'device-item';
      deviceElement.setAttribute('data-device-id', device.id);
      deviceElement.innerHTML = deviceHtml;
      devicesList.appendChild(deviceElement);
    }
  }

  function updateDevicesList(devices) {
    console.log('Updating devices list:', devices);
    devicesList.innerHTML = '';
    devices.forEach(device => updateDeviceInList(device));
  }

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
    // send color
    ipcRenderer.send('setColor', { deviceId, color });
  };
});
