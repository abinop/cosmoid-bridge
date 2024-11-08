# Cosmoid Bridge - Technical Specification

## Overview
Cosmoid Bridge is a cross-platform desktop application that acts as a bridge between web applications and Bluetooth Low Energy (BLE) devices. It provides a WebSocket server that web clients can connect to for controlling BLE devices.

## Core Architecture

### 1. Core Components (.NET MAUI)

#### BLE Service Layer
- Interface: `IBleService`
- Key Methods:
  ```csharp
  Task InitializeAsync();           // Initialize BLE adapter
  Task StartScanningAsync();        // Begin device discovery
  Task StopScanningAsync();         // Stop device discovery
  Task<bool> ConnectToDeviceAsync(string deviceId);  // Connect to specific device
  Task SendCommandAsync(string deviceId, string command, byte[] data);  // Send commands
  ```

#### Events:
```csharp
event EventHandler<CosmoDevice> DeviceDiscovered;
event EventHandler<CosmoDevice> DeviceConnected;
event EventHandler<CosmoDevice> DeviceDisconnected;
event EventHandler<string> Error;
```

#### WebSocket Server
- Handles client connections on port 54545
- Provides real-time device updates
- Supports commands:
  - `scan`: Start device scanning
  - `connect`: Connect to device
  - `sendEvent`: Send commands to device
  - `getDevices`: Get list of discovered devices

### 2. Device Communication

#### BLE Protocol
- Service UUID: `00001523-1212-efde-1523-785feabcd123`
- Characteristics:
  - Sensor: `00001524-1212-efde-1523-785feabcd123`
  - Button Status: `00001525-1212-efde-1523-785feabcd123`
  - Command: `00001528-1212-efde-1523-785feabcd123`

#### Commands
1. Set Luminosity:
   ```
   [0x01, intensity (0-100), delay]
   ```

2. Set Color:
   ```
   [0x02, r (0-4), g (0-4), b (0-4), mode (1)]
   ```

### 3. UI Components

#### Main Window
- Status bar showing WebSocket server status
- Device list with:
  - Device name
  - Device ID
  - Signal strength (RSSI)
  - Connect/Disconnect button
- Settings section:
  - Auto-start option
  - System tray minimize button

### 4. Platform-Specific Implementation

#### Windows
- Uses Windows Bluetooth APIs
- System tray integration
- Auto-start via registry

#### macOS
- Uses CoreBluetooth framework
- Menu bar integration
- Auto-start via Launch Agents

## Data Models

### CosmoDevice
```csharp
public class CosmoDevice
{
    public string Id { get; set; }
    public string Name { get; set; }
    public int Rssi { get; set; }
    public bool IsConnected { get; set; }
    public Dictionary<string, ICharacteristic> Characteristics { get; set; }
}
```

## WebSocket Protocol

### Messages from Client to Server

1. Scan for Devices:
```json
{
    "type": "scan"
}
```

2. Connect to Device:
```json
{
    "type": "connect",
    "deviceId": "device_id"
}
```

3. Send Command:
```json
{
    "type": "sendEvent",
    "deviceId": "device_id",
    "eventType": "setLuminosity",
    "data": [50, 1]  // intensity, delay
}
```

### Messages from Server to Client

1. Device Discovered:
```json
{
    "type": "deviceFound",
    "device": {
        "id": "device_id",
        "name": "Device Name",
        "rssi": -65,
        "connected": false
    }
}
```

2. Device Connected:
```json
{
    "type": "deviceConnected",
    "device": {
        "id": "device_id",
        "name": "Device Name",
        "connected": true
    }
}
```

## Implementation Notes

1. Use MVVM pattern with `CommunityToolkit.Mvvm`
2. Implement platform-specific BLE services using dependency injection
3. Handle background operations and UI updates on main thread
4. Implement proper error handling and user feedback
5. Support system tray/menu bar integration
6. Maintain persistent WebSocket connections
7. Handle device reconnection scenarios
8. Implement proper cleanup on application exit

## Key Features to Implement

1. Real-time device discovery and status updates
2. Reliable BLE device connection management
3. WebSocket server for client communication
4. Platform-specific BLE implementations
5. System tray/menu bar integration
6. Auto-start capability
7. Error handling and user feedback
8. Device command protocol support

## Required NuGet Packages

```xml
<ItemGroup>
    <PackageReference Include="CommunityToolkit.Mvvm" Version="8.2.2" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" Version="8.0.0" />
    <PackageReference Include="Plugin.BLE" Version="3.0.0" />
    <PackageReference Include="System.Net.WebSockets" Version="4.3.0" />
</ItemGroup>
```

## Platform Support
- Windows 10/11 (Windows.Devices.Bluetooth API)
- macOS (CoreBluetooth framework)

## Development Requirements
- .NET 8.0
- .NET MAUI SDK
- Visual Studio 2022 or later with MAUI workload
- Xcode (for macOS development)

## Project Structure

```
CosmoidBridge.Maui/
├── Models/
│   ├── CosmoDevice.cs
│   └── WebSocketMessage.cs
├── Services/
│   ├── IBleService.cs
│   ├── IWebSocketServer.cs
│   ├── BleService.cs
│   └── WebSocketServer.cs
├── ViewModels/
│   ├── MainViewModel.cs
│   └── SettingsViewModel.cs
├── Views/
│   ├── MainPage.xaml
│   └── SettingsPage.xaml
├── Platforms/
│   ├── Windows/
│   │   └── BleImplementation.cs
│   └── MacCatalyst/
│       └── BleImplementation.cs
└── App.xaml
```

## Additional Implementation Details

### Error Handling
- Implement retry logic for BLE connections
- Provide user feedback for connection failures
- Log errors for debugging
- Handle WebSocket connection drops

### Security Considerations
- Implement WebSocket security (if needed)
- Handle BLE pairing requirements
- Secure storage of device information

### Performance Considerations
- Optimize BLE scanning intervals
- Handle multiple client connections efficiently
- Manage memory usage for long-running operations

### Testing Requirements
- Unit tests for core business logic
- Integration tests for BLE communication
- UI automation tests
- WebSocket communication tests

This technical specification provides a comprehensive guide for implementing the Cosmoid Bridge application in .NET MAUI. The developer should follow MVVM patterns and implement proper error handling and platform-specific features as described above.