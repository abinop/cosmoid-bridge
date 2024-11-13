# Cosmoid Bridge Technical Specification

## Overview
Cosmoid Bridge is an Electron-based application that serves as a bridge between web applications and Bluetooth Low Energy (BLE) devices. It provides a WebSocket server interface for web clients to interact with BLE devices, specifically designed for Cosmoid hardware.

## Architecture

### Core Components
1. **Main Process** (`src/main/index.js`)
   - Initializes the Electron application
   - Creates the system tray
   - Manages the main window
   - Initializes BLE and WebSocket servers

2. **BLE Server** (`src/main/ble-server.js`)
   - Handles all BLE device interactions
   - Manages device discovery and connections
   - Handles characteristic reading/writing
   - Emits device events

3. **WebSocket Server** (`src/main/ws-server.js`)
   - Provides WebSocket interface for clients
   - Bridges BLE events to connected clients
   - Handles client commands
   - Broadcasts device updates

4. **Renderer Process** (`src/renderer/index.js`)
   - Provides UI for device management
   - Connects to WebSocket server
   - Displays device status and controls

## Communication Flow

### 1. BLE Device Discovery
1. Client sends discovery request via WebSocket
2. WebSocket server forwards request to BLE server
3. BLE server initiates device scanning
4. Discovered devices are broadcast to all connected clients
5. Scanning continues until explicitly stopped or timeout reached

### 2. Device Connection
1. Client requests connection to specific device by MAC address
2. WebSocket server validates request and forwards to BLE server
3. BLE server attempts connection
4. Connection status updates are broadcast to all clients
5. Upon successful connection, device services and characteristics are discovered

### 3. Data Exchange
1. **Reading Data**
   - Client requests characteristic read
   - Request routed through WebSocket → BLE server
   - Data returned via same path in reverse
   - Notifications/Indications handled similarly

2. **Writing Data**
   - Client sends write request with data
   - Data validated by WebSocket server
   - BLE server performs write operation
   - Write confirmation broadcast to clients

## Security Considerations

### WebSocket Security
1. Local-only connections (127.0.0.1)
2. Optional authentication token
3. Request validation and sanitization
4. Rate limiting for connections and requests

### BLE Security
1. Device whitelisting
2. Encryption support (if provided by device)
3. Connection timeout management
4. Automatic disconnection on idle

## Error Handling

### WebSocket Errors
1. Connection failures
2. Invalid message format
3. Authentication failures
4. Rate limit exceeded

### BLE Errors
1. Device connection failures
2. Read/Write operation failures
3. Device disconnections
4. Scanning failures

## Performance Considerations

### Resource Management
1. Maximum concurrent connections
2. Scanning duration limits
3. Memory usage monitoring
4. CPU usage optimization

### Latency Optimization
1. Message queuing
2. Batch operations where possible
3. Connection pooling
4. Event debouncing

## Development Setup

### Prerequisites
- Node.js 16+
- Electron 22+
- Compatible Bluetooth adapter
- Development OS: Windows 10+, macOS 10.15+, or Linux

### Build Process
1. `npm install` - Install dependencies
2. `npm run dev` - Start development environment
3. `npm run build` - Create production build
4. `npm run test` - Run test suite

## Deployment

### Distribution
1. Platform-specific builds
2. Auto-update mechanism
3. Installation procedures
4. System requirements

### Monitoring
1. Error logging
2. Usage analytics
3. Performance metrics
4. Health checks

## Future Considerations

### Planned Features
1. Multiple device support
2. Custom protocol implementations
3. Extended device filtering
4. Advanced security features

### Scalability
1. Service worker integration
2. Multiple window support
3. Plugin architecture
4. API versioning

## BLE Implementation Details

### Services and Characteristics

#### 1. Device Information Service (0x180A)
- **Manufacturer Name** (0x2A29)
  - Read only
  - UTF-8 string
  - Returns "Cosmoid Labs"

- **Model Number** (0x2A24)
  - Read only
  - UTF-8 string
  - Format: "CSM-{model_id}"

- **Firmware Version** (0x2A26)
  - Read only
  - UTF-8 string
  - Format: "v{major}.{minor}.{patch}"

#### 2. Battery Service (0x180F)
- **Battery Level** (0x2A19)
  - Read, Notify
  - UInt8 (0-100%)
  - Notification interval: 60 seconds

#### 3. Cosmoid Control Service (0xCSM1)
- **Device Status** (0xCSM2)
  - Read, Notify
  - Uint8
  - States:
    - 0x00: Standby
    - 0x01: Active
    - 0x02: Error
    - 0x03: Calibrating
    - 0x04: Updating

- **Command Characteristic** (0xCSM3)
  - Write, Write Without Response
  - Max length: 20 bytes
  - Command Format:
    ```
    [Command ID (1 byte)][Payload (0-19 bytes)]
    ```
  - Commands:
    - 0x01: Start Operation
    - 0x02: Stop Operation
    - 0x03: Reset Device
    - 0x04: Enter DFU Mode
    - 0x05: Request Diagnostics

- **Data Stream** (0xCSM4)
  - Read, Notify
  - Max length: 20 bytes
  - Data Format:
    ```
    [Timestamp (4 bytes)][Data Type (1 byte)][Payload (15 bytes)]
    ```
  - Data Types:
    - 0x01: Sensor Reading
    - 0x02: Event Log
    - 0x03: Error Report
    - 0x04: Status Update

#### 4. Cosmoid Sensor Service (0xCSM5)
- **Sensor Configuration** (0xCSM6)
  - Read, Write
  - Length: 4 bytes
  - Configuration Format:
    ```
    [Sample Rate (1 byte)][Resolution (1 byte)][Mode (1 byte)][Reserved (1 byte)]
    ```
  - Sample Rates:
    - 0x01: 1 Hz
    - 0x02: 10 Hz
    - 0x03: 50 Hz
    - 0x04: 100 Hz

- **Sensor Data** (0xCSM7)
  - Read, Notify
  - Length: Variable (max 20 bytes)
  - Data Format:
    ```
    [Sensor ID (1 byte)][Reading Count (1 byte)][Readings (2 bytes each)]
    ```

### Connection Parameters
- Connection Interval: 7.5-15ms
- Slave Latency: 0
- Supervision Timeout: 4000ms
- MTU Size: 23 bytes (default) - 247 bytes (negotiable)

### Security Requirements
- Pairing Required: Yes
- Bonding: Optional
- Encryption: Required (AES-128)
- Authentication: Required
- MITM Protection: Required

### Error Codes
- 0x01: Invalid Command
- 0x02: Invalid Parameter
- 0x03: Operation Failed
- 0x04: Device Busy
- 0x05: Authentication Failed
- 0x06: Timeout
- 0x07: Hardware Error

### Power Management
- Advertising Interval: 100ms
- Connection Power Mode: Low Power
- Sleep Mode Timeout: 300 seconds
- Wake-on-BLE: Supported