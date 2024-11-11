// Renderer process code
const { ipcRenderer } = require('electron');

// Add WebSocket handling for device updates
let ws;

function setupWebSocket() {
    ws = new WebSocket('ws://localhost:8080/ws');
    
    ws.onopen = () => {
        console.log('Connected to WebSocket server');
        // Request initial device list
        ws.send(JSON.stringify({ type: 'getDevices' }));
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('WebSocket message received:', data);
            
            if (data.devices) {
                updateDeviceList(data.devices);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
        setTimeout(setupWebSocket, 2000); // Attempt to reconnect
    };

    return ws;
}

// Add refresh function
function refreshDevices() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'refreshDevices' }));
    }
}

// UI update functions
function updateDeviceList(devices) {
    const devicesList = document.getElementById('devicesList');
    if (!devicesList) return;

    devicesList.innerHTML = `
        <div class="refresh-button mb-4">
            <button onclick="refreshDevices()" class="px-4 py-2 bg-blue-500 text-white rounded">
                🔄 Refresh Devices
            </button>
        </div>
    `;

    if (devices.length === 0) {
        devicesList.innerHTML += '<div class="no-devices">No devices connected</div>';
        return;
    }

    devices.forEach(device => {
        const deviceElement = document.createElement('div');
        deviceElement.className = 'device-item p-4 border rounded mb-2';
        deviceElement.innerHTML = `
            <div class="device-header">
                <span class="device-name">${device.name || 'Unknown Device'}</span>
                <span class="connection-status ${device.connected ? 'connected' : 'disconnected'}">
                    ${device.connected ? '🟢 Connected' : '⚪ Disconnected'}
                </span>
            </div>
            ${device.connected ? `
                <div class="device-info mt-2">
                    ${device.serialNumber ? `<div>Serial: ${device.serialNumber}</div>` : ''}
                    ${device.firmwareVersion ? `<div>Firmware: ${device.firmwareVersion}</div>` : ''}
                </div>
            ` : ''}
        `;
        devicesList.appendChild(deviceElement);
    });
}

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Setup WebSocket connection
    setupWebSocket();

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

// Handle IPC events from main process
ipcRenderer.on('deviceDiscovered', (event, device) => {
    console.log('Device discovered:', device);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getDevices' }));
    }
});

ipcRenderer.on('deviceRemoved', (event, deviceId) => {
    console.log('Device removed:', deviceId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getDevices' }));
    }
});
