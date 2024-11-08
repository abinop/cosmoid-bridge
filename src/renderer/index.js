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
      <div class="device-item" data-device-id="${device.id}">
        <div class="device-info-container">
          <span class="status-indicator ${device.connected ? 'connected' : ''}">${device.connected ? '🟢' : '⚪️'}</span>
          ${device.serialNumber ? `<span class="device-info">Serial: ${device.serialNumber}</span>` : ''}
          ${device.batteryLevel !== null ? `<span class="device-info">Battery: ${device.batteryLevel}%</span>` : ''}
        </div>
        <div class="device-controls">
          ${!device.connected ? `
            <button class="button" onclick="connectDevice('${device.id}')">Connect</button>
          ` : `
            <button class="button" onclick="setRandomLuminosity('${device.id}')">Random Brightness</button>
            <button class="button" onclick="setRandomColor('${device.id}')">Random Color</button>
          `}
        </div>
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
    // Start battery updates
    startBatteryUpdates();
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
        // Handle generic events
        handleDeviceEvent(message.event);
        break;

      case 'deviceFound':
      case 'deviceConnected':
        // Request updated device list
        ws.send(JSON.stringify({ type: 'getDevices' }));
        break;
      
      case 'devicesList':
        updateDevicesList(message.devices);
        break;
        
      case 'characteristicChanged':
        console.log('Characteristic changed:', message);
        break;

      case 'eventResult':
        console.log(
          message.success ? 
          'Command sent successfully' : 
          'Failed to send command'
        );
        break;

      case 'setColor':
        if (message.deviceId && Array.isArray(message.data)) {
          const [r, g, b] = message.data;
          ws.send(JSON.stringify({
            type: 'sendEvent',
            deviceId: message.deviceId,
            eventType: 'setColor',
            data: [r, g, b]
          }));
        }
        break;

      case 'setLuminosity':
        if (message.deviceId && Array.isArray(message.data)) {
          const [intensity] = message.data;
          console.log(`External call: Setting luminosity to ${intensity}% for device ${message.deviceId}`);
          ws.send(JSON.stringify({
            type: 'sendEvent',
            deviceId: message.deviceId,
            eventType: 'setLuminosity',
            data: [intensity, 1] // [intensity, delay]
          }));
        }
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

  // Add command functions
  window.setRandomLuminosity = (deviceId) => {
    const luminosity = Math.floor(Math.random() * 60) + 5; // 5-64%
    console.log(`Setting luminosity to ${luminosity}% for device ${deviceId}`);
    
    ws.send(JSON.stringify({
      type: 'sendEvent',
      deviceId,
      eventType: 'setLuminosity',
      data: [luminosity, 1] // [intensity, delay]
    }));
  };

  window.setRandomColor = (deviceId) => {
    // Use values between 0-4 to match the example code
    const r = Math.floor(Math.random() * 5); // 0-4
    const g = Math.floor(Math.random() * 5); // 0-4
    const b = Math.floor(Math.random() * 5); // 0-4
    console.log(`Setting color to RGB(${r},${g},${b}) for device ${deviceId}`);
    
    ws.send(JSON.stringify({
      type: 'sendEvent',
      deviceId,
      eventType: 'setColor',
      data: [r, g, b] // The mode (1) is added in the server
    }));
  };

  // Add periodic battery level updates for connected devices
  function startBatteryUpdates() {
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'updateBatteryLevels' }));
      }
    }, 30000); // Update every 30 seconds
  }
});
