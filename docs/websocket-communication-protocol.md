# WebSocket Communication Protocol Documentation

## Overview
This document outlines the WebSocket communication protocol used for BLE (Bluetooth Low Energy) device communication. The protocol handles device discovery, connection management, and device-specific operations.

## Connection Details
- WebSocket Server URL: `ws://localhost:8080`
- Protocol: WebSocket (ws://)
- Default Port: 8080

## Message Types

### Client to Server Messages

#### 1. Device Discovery
```json
{
    "type": "scan"
}
```
Initiates BLE device scanning.

#### 2. Get Devices List
```json
{
    "type": "getDevices"
}
```
Requests the list of all known BLE devices.

#### 3. Connect to Device
```json
{
    "type": "connect",
    "deviceId": "device_identifier"
}
```

#### 4. Write Characteristic
```json
{
    "type": "write",
    "deviceId": "device_identifier",
    "characteristicUUID": "uuid_string",
    "value": "data_to_write"
}
```

#### 5. Send Event
```json
{
    "type": "sendEvent",
    "deviceId": "device_identifier",
    "eventType": "event_type",
    "data": "event_data"
}
```

#### 6. Set Color
```json
{
    "type": "setColor",
    "deviceId": "device_identifier",
    "data": [/* color values array */]
}
```

#### 7. Set Luminosity
```json
{
    "type": "setLuminosity",
    "deviceId": "device_identifier",
    "data": [/* luminosity values array */]
}
```

#### 8. Update Battery Levels
```json
{
    "type": "updateBatteryLevels"
}
```
Requests battery level update for all connected devices.

### Server to Client Messages

#### 1. Device Discovery Response
```json
{
    "type": "deviceFound",
    "device": {
        // Device information
    }
}
```

#### 2. Device Connection Status
```json
{
    "type": "deviceConnected",
    "device": {
        // Connected device information
    }
}
```
```json
{
    "type": "deviceDisconnected",
    "device": {
        // Disconnected device information
    }
}
```

#### 3. Devices List Update
```json
{
    "type": "devicesList",
    "devices": [
        // Array of device objects
    ]
}
```

#### 4. Device Information Update
```json
{
    "type": "deviceInfo",
    "deviceId": "device_identifier",
    // Additional device information
}
```

#### 5. Characteristic Change Notification
```json
{
    "type": "characteristicChanged",
    // Changed characteristic data
}
```

#### 6. Button Event
```json
{
    "type": "buttonEvent",
    // Button event data
}
```

#### 7. Operation Results
```json
{
    "type": "connectResult",
    "deviceId": "device_identifier",
    "success": boolean
}
```
```json
{
    "type": "writeResult",
    "deviceId": "device_identifier",
    "success": boolean
}
```
```json
{
    "type": "eventResult",
    "success": boolean,
    "originalEvent": {
        // Original event data
    }
}
```

## Implementation Notes

### Server Features
1. Maintains a set of connected WebSocket clients
2. Broadcasts messages to all connected clients
3. Integrates with BLE server for device communication
4. Handles automatic device updates and notifications

### Error Handling
- All message handling is wrapped in try-catch blocks
- Failed operations return success: false in response
- Connection errors are handled automatically

### Best Practices
1. Always check operation results through corresponding response messages
2. Handle device disconnection events appropriately
3. Implement reconnection logic for both WebSocket and BLE connections
4. Monitor device status changes through devicesList updates
5. Handle battery level updates periodically

This documentation reflects the actual implementation of the WebSocket server and its communication protocol for BLE device management.