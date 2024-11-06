document.addEventListener('DOMContentLoaded', () => {
  const devicesList = document.getElementById('devices-list');
  
  function addOrUpdateDevice(device) {
    console.log('Adding/Updating device:', device);
    let deviceElement = document.getElementById(`device-${device.id}`);
    
    if (!deviceElement) {
      console.log('Creating new device element:', device);
      deviceElement = document.createElement('div');
      deviceElement.id = `device-${device.id}`;
      deviceElement.className = 'device-item';
      devicesList.appendChild(deviceElement);
    }

    const buttonState = device.connected ? 'Connected' : 'Connect';
    const buttonDisabled = device.connected ? 'disabled' : '';

    deviceElement.innerHTML = `
      <div>
        <strong>${device.name}</strong>
        <br>
        ID: ${device.id}
        <br>
        Signal: ${device.rssi || 'N/A'} dBm
        <br>
        Status: ${device.connected ? 'Connected' : 'Not Connected'}
      </div>
      <div class="device-controls">
        <button onclick="connectToDevice('${device.id}')" 
                ${buttonDisabled}
                id="connect-${device.id}">
          ${buttonState}
        </button>
      </div>
    `;
  }

  // WebSocket setup
  const ws = new WebSocket('ws://localhost:54545');
  window.ws = ws;

  ws.onopen = () => {
    console.log('WebSocket connection established');
    // Request initial device list
    ws.send(JSON.stringify({ type: 'getDevices' }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Received WebSocket message:', message);

    switch (message.type) {
      case 'devicesList':
        console.log('Received devices list:', message.devices);
        devicesList.innerHTML = ''; // Clear existing devices
        message.devices.forEach(device => addOrUpdateDevice(device));
        break;
      case 'deviceFound':
        console.log('Device found:', message.device);
        addOrUpdateDevice(message.device);
        break;
      case 'deviceUpdated':
        console.log('Device updated:', message.device);
        addOrUpdateDevice(message.device);
        break;
      case 'deviceConnected':
        console.log('Device connected:', message.device);
        addOrUpdateDevice(message.device);
        break;
      case 'deviceDisconnected':
        console.log('Device disconnected:', message.device);
        addOrUpdateDevice(message.device);
        break;
      case 'connectResult':
        const button = document.querySelector(`#connect-${message.deviceId}`);
        if (button) {
          button.disabled = false;
          if (message.success) {
            button.textContent = 'Connected';
            button.disabled = true;
          } else {
            button.textContent = 'Connect';
            if (message.error) {
              alert(`Connection failed: ${message.error}`);
            }
          }
        }
        break;
      case 'error':
        console.error('Received error:', message.error);
        alert(`Error: ${message.error}`);
        break;
    }
  };

  // Add global functions
  window.startScanning = function() {
    console.log('Starting scan...');
    devicesList.innerHTML = ''; // Clear existing devices
    ws.send(JSON.stringify({ type: 'scan' }));
  };

  window.connectToDevice = function(deviceId) {
    console.log('Attempting to connect to device:', deviceId);
    const button = document.querySelector(`#connect-${deviceId}`);
    if (button) {
      button.disabled = true;
      button.textContent = 'Connecting...';
    }
    
    ws.send(JSON.stringify({
      type: 'connect',
      deviceId: deviceId
    }));
  };
});
