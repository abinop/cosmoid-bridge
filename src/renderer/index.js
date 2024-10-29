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

  // Function to update the UI with the list of devices
  function updateDevicesList(devices) {
    console.log('Updating devices list:', devices);
    devicesList.innerHTML = devices.map(device => `
      <div class="device-item" data-device-id="${device.id}">
        <h3>${device.name}</h3>
        <p>ID: ${device.id}</p>
        <p>Status: ${device.connected ? '🟢 Connected' : '⚪️ Discovered'}</p>
        ${!device.connected ? `
          <button class="button" onclick="connectDevice('${device.id}')">
            Connect
          </button>
        ` : `
          <div class="device-controls">
            <button class="button" onclick="setRandomLuminosity('${device.id}')">
              Random Brightness
            </button>
            <button class="button" onclick="setRandomColor('${device.id}')">
              Random Color
            </button>
          </div>
        `}
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
      case 'deviceDisconnected':
        console.log('Device disconnected:', message.device);
        // Remove the device from the UI
        const deviceElement = document.querySelector(`[data-device-id="${message.device.id}"]`);
        if (deviceElement) {
          deviceElement.remove();
        }
        // Update the list after removal
        ws.send(JSON.stringify({ type: 'getDevices' }));
        break;

      case 'event':
        // Handle generic events from the device
        handleDeviceEvent(message.event);
        break;

      case 'eventResult':
        console.log(
          message.success ? 
          'Command sent successfully' : 
          'Failed to send command'
        );
        break;

      // Handle other message types...
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

  function handleDeviceEvent(event) {
    console.log('Received device event:', event);
    // Handle different event types
    switch(event.type) {
      case 'characteristicChanged':
        // Handle characteristic changes
        break;
      // Add other event type handlers
    }
  }

  // Function to send events to device
  function sendEventToDevice(deviceId, eventType, data) {
    ws.send(JSON.stringify({
      type: 'sendEvent',
      deviceId,
      eventType,
      data
    }));
  }

  // Function to set random brightness (0-100%)
  window.setRandomLuminosity = (deviceId) => {
    const luminosity = Math.floor(Math.random() * 100); // Generate random brightness
    console.log(`Setting luminosity to ${luminosity}% for device ${deviceId}`);
    
    ws.send(JSON.stringify({
      type: 'sendEvent',
      deviceId,
      eventType: 'setLuminosity',
      data: [luminosity, 1] // [intensity, delay]
    }));
  };

  // Function to set random color (values 0-4 for each RGB component)
  window.setRandomColor = (deviceId) => {
    const r = Math.floor(Math.random() * 5); // 0-4 for red
    const g = Math.floor(Math.random() * 5); // 0-4 for green
    const b = Math.floor(Math.random() * 5); // 0-4 for blue
    console.log(`Setting color to RGB(${r},${g},${b}) for device ${deviceId}`);
    
    ws.send(JSON.stringify({
      type: 'sendEvent',
      deviceId,
      eventType: 'setColor',
      data: [r, g, b] // The mode (1) is added in the server
    }));
  };
});
