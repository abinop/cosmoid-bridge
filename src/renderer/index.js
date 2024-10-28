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

  // Handle device updates
  function updateDevicesList(devices) {
    console.log('Updating devices list:', devices);
    devicesList.innerHTML = devices.map(device => `
      <div class="device-item">
        <h3>${device.name}</h3>
        <p>ID: ${device.id}</p>
        <p>Status: ${device.connected ? '🟢 Connected' : '⚪️ Discovered'}</p>
        ${!device.connected ? `
          <button class="button" onclick="connectDevice('${device.id}')">
            Connect
          </button>
        ` : ''}
      </div>
    `).join('');
  }

  // Setup WebSocket connection to receive device updates
  const ws = new WebSocket('ws://localhost:8080');
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    // Request initial device list
    ws.send(JSON.stringify({ type: 'getDevices' }));
    // Start scanning
    ws.send(JSON.stringify({ type: 'scan' }));
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Received message:', message);
    
    switch(message.type) {
      case 'deviceFound':
      case 'deviceConnected':
      case 'deviceDisconnected':
      case 'deviceUpdated':
        // Request updated device list
        ws.send(JSON.stringify({ type: 'getDevices' }));
        break;
      
      case 'devicesList':
        updateDevicesList(message.devices);
        break;
        
      case 'characteristicChanged':
        console.log('Characteristic changed:', message);
        break;
    }
  };

  // Periodically request device updates
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'getDevices' }));
    }
  }, 5000);

  // Connect to device
  window.connectDevice = (deviceId) => {
    ws.send(JSON.stringify({
      type: 'connect',
      deviceId
    }));
  };
});
