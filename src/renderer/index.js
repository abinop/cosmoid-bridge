// Renderer process code
const { ipcRenderer } = require('electron');

// Add WebSocket connection handling with automatic reconnection
function setupWebSocket() {
    const ws = new WebSocket('ws://localhost:8080');
    
    ws.onopen = () => {
        console.log('🌐 WebSocket Connected');
        document.querySelector('.status').classList.add('running');
        // Request initial device list
        ws.send(JSON.stringify({ type: 'getDevices' }));
    };

    ws.onclose = () => {
        console.log('🔴 WebSocket Disconnected - Attempting to reconnect...');
        document.querySelector('.status').classList.remove('running');
        // Wait for 2 seconds before attempting to reconnect
        setTimeout(setupWebSocket, 2000);
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket Error:', error);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📥 Received message:', data);

            switch(data.type) {
                case 'devicesList':
                    updateDeviceList(data.devices);
                    break;
                case 'deviceDiscovered':
                    handleDeviceDiscovered(data.device);
                    break;
                case 'deviceConnected':
                    handleDeviceConnected(data.device);
                    break;
                case 'deviceDisconnected':
                    handleDeviceDisconnected(data.device);
                    break;
                case 'deviceUpdated':
                    handleDeviceUpdated(data);
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    };

    return ws;
}

// UI update functions
function updateDeviceList(devices) {
    console.log('📱 Updating Cosmo list:', devices);
    const devicesList = document.getElementById('devicesList');
    if (!devicesList) {
        console.error('❌ devicesList element not found');
        return;
    }

    if (!devices || devices.length === 0) {
        devicesList.innerHTML = '<div class="no-devices">No devices connected</div>';
        return;
    }

    devicesList.innerHTML = devices.map(device => `
        <div class="device-item ${device.connected ? 'connected' : ''}" data-id="${device.id}">
            <div class="device-header">
                <span class="device-name">${device.name || 'Unknown Device'}</span>
                <span class="connection-status ${device.connected ? 'connected' : 'disconnected'}">
                    ${device.connected ? '🟢 Connected' : '⚪ Disconnected'}
                </span>
            </div>
            <div class="device-details">
                <div class="device-info">
                    <div>ID: ${device.id}</div>
                    ${device.serialNumber ? `<div>Serial: ${device.serialNumber}</div>` : ''}
                    ${device.batteryLevel ? `<div>Battery: ${device.batteryLevel}%</div>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function handleDeviceDiscovered(device) {
    console.log('Device discovered:', device);
    // Request updated device list
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getDevices' }));
    }
}

function handleDeviceConnected(device) {
    console.log('Device connected:', device);
    // Request updated device list
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getDevices' }));
    }
}

function handleDeviceDisconnected(device) {
    console.log('Device disconnected:', device);
    // Request updated device list
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getDevices' }));
    }
}

function handleDeviceUpdated(updateData) {
    console.log('🔵 Cosmo update received:', {
        devices: updateData.devices,
        deviceInfo: updateData.deviceInfo
    });
    if (updateData.devices) {
        updateDeviceList(updateData.devices);
    }
}

// Initialize WebSocket connection and UI handlers
let ws;
document.addEventListener('DOMContentLoaded', () => {
    // Initialize WebSocket
    ws = setupWebSocket();

    // Setup auto-launch checkbox handler
    const autoLaunchCheckbox = document.getElementById('autoLaunch');
    if (autoLaunchCheckbox) {
        autoLaunchCheckbox.addEventListener('change', (e) => {
            ipcRenderer.send('toggle-auto-launch', e.target.checked);
        });
    }

    // Setup hide window button handler
    const hideButton = document.getElementById('hideWindow');
    if (hideButton) {
        hideButton.addEventListener('click', () => {
            ipcRenderer.send('hide-window');
        });
    }
});
