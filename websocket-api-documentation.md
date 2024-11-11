# WebSocket API Documentation for Cosmoid Bridge

This documentation describes the WebSocket communication protocol between the Electron Bridge application and the React web client.

## Connection Details

- **WebSocket URL**: `ws://localhost:8080`
- **Protocol**: WebSocket
- **Format**: All messages are sent as JSON strings

## Message Structure

All messages follow this basic structure:
```json
{
  "type": "messageType",
  "deviceId": "optional-device-id",
  "data": "payload-data"
}
```

## Server -> Client Messages

### 1. Connection Status

#### Connected
```json
{
  "type": "connected"
}
```

#### Disconnected
```json
{
  "type": "disconnected"
}
```

#### Connection Failed
```json
{
  "type": "connectionFailed",
  "message": "Error message"
}
```

### 2. Device Information

#### Device List Update
```json
{
  "type": "devicesList",
  "devices": [
    {
      "id": "device-id-1",
      "name": "Device Name"
    }
  ]
}
```

#### Device Info Response
```json
{
  "type": "deviceInfo",
  "deviceId": "device-id",
  "serialNumber": "serial-number",
  "hardwareRevision": "hw-revision",
  "firmwareRevision": "fw-revision"
}
```

#### Characteristic Value Change
```json
{
  "type": "characteristicChanged",
  "deviceId": "device-id",
  "characteristicUUID": "uuid",
  "value": [0] // Array of values
}
```

## Client -> Server Messages

### 1. Device Operations

#### Get Device List
```json
{
  "type": "getDevices"
}
```

#### Get Device Info
```json
{
  "type": "getDeviceInfo",
  "deviceId": "device-id"
}
```

#### Subscribe to Characteristic
```json
{
  "type": "subscribe",
  "deviceId": "device-id",
  "characteristicUUID": "uuid"
}
```

### 2. LED Control

#### Set Color
```json
{
  "type": "setColor",
  "deviceId": "device-id",
  "data": [r, g, b] // Values from 0-4
}
```

#### Set Luminosity
```json
{
  "type": "setLuminosity",
  "deviceId": "device-id",
  "data": [intensity] // Value from 5-64
}
```

## Important UUIDs

- Force Sensor Characteristic: `000015241212efde1523785feabcd123`
- Button Press Characteristic: `000015251212efde1523785feabcd123`

## Implementation Notes

1. **Connection Management**
   - The server should attempt to reconnect automatically when connection is lost
   - Maximum 5 reconnection attempts with 2-second intervals
   - Client should be notified of connection status changes

2. **Device Updates**
   - Server should send device list updates whenever devices connect/disconnect
   - Client will request device info for each new device
   - Client will subscribe to relevant characteristics automatically

3. **LED Control**
   - Color values are in RGB format with each component ranging from 0-4
   - Luminosity values range from 5-64
   - Values outside these ranges should be clamped

4. **Error Handling**
   - All errors should be reported with appropriate error messages
   - Connection errors should trigger reconnection attempts
   - Invalid messages should be logged but not crash the server

## Example Implementation (Node.js)

```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  // Handle new connection
  ws.send(JSON.stringify({ type: 'connected' }));

  // Send initial device list
  ws.send(JSON.stringify({
    type: 'devicesList',
    devices: getConnectedDevices() // Your implementation
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'getDevices':
          // Send device list
          break;
        case 'setColor':
          // Handle color setting
          // Validate: data.data[0-2] should be 0-4
          break;
        case 'setLuminosity':
          // Handle brightness
          // Validate: data.data[0] should be 5-64
          break;
        // Handle other message types
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
});
```

## Testing

To test the WebSocket connection:

1. Use a WebSocket client (like wscat) to connect:
```bash
wscat -c ws://localhost:8080
```

2. Send a test message:
```json
{"type": "getDevices"}
```

3. Verify you receive a response with the device list.

## Error Codes

- 1000: Normal closure
- 1001: Going away
- 1002: Protocol error
- 1003: Unsupported data
- 1006: Abnormal closure
- 1007: Invalid frame payload data
- 1008: Policy violation
- 1009: Message too big
- 1010: Mandatory extension
- 1011: Internal server error
- 1015: TLS handshake failure
