# Cosmo BLE Protocol Documentation

## Overview
This document describes the Bluetooth Low Energy (BLE) protocol used to communicate with Cosmo devices. This specification can be implemented in any programming language that supports BLE communication.

## Device Services

### 1. Main Cosmo Service
**UUID**: `00001523-1212-EFDE-1523-785FEABCD123`

Characteristics:
- Sensor: `00001524-1212-EFDE-1523-785FEABCD123`
- Button Status: `00001525-1212-EFDE-1523-785FEABCD123`
- Sensor Raw Values: `00001526-1212-EFDE-1523-785FEABCD123`
- Command Status: `00001527-1212-EFDE-1523-785FEABCD123`
- Command: `00001528-1212-EFDE-1523-785FEABCD123`

### 2. DFU Service (Device Firmware Update)
**UUID**: `00001530-1212-EFDE-1523-785FEABCD123`

Characteristics:
- DFU Packet: `00001532-1212-EFDE-1523-785FEABCD123`
- DFU Control Point: `00001531-1212-EFDE-1523-785FEABCD123`
- DFU Version: `00001534-1212-EFDE-1523-785FEABCD123`

## Device Operations

### LED Control
- Set Color (RGB values)
- Set LED Mode
  - Multiple color modes available
  - Calibration can be enabled/disabled
- Set Luminosity
  - Parameters:
    - intensity: UInt8 (0-255)
    - delay: UInt8

### Device Configuration
Parameters that can be set:
- Sensor Threshold (UInt8)
- LED Luminosity (UInt8)
- Auto Calibration (Boolean)
- LED Mode
- Sensor Value Notification Enable
- Raw Sensor Value Notification Enable
- Button Mode (UInt8)
- Sounder Mode (UInt8)

### Calibration Operations
- Zero Point Calibration
- Maximum Point Calibration
- Set Min/Max Values
  - Min Value (UInt8)
  - Max Value (UInt8)

### HID Mode
- Enter HID Mode
- Clear HID Bonds
- Store and Reset to HID
- Set HID Configuration

### Firmware Updates
Update Process:
1. Device enters DFU mode
2. Set LED to white color
3. Set medium luminosity
4. Transfer firmware packets
5. Verify update
6. Reset device

## Device States
- Connected
- Disconnected
- Firmware Update Mode
- HID Mode

## Persistent Storage
The device stores:
- Minimum Value
- Maximum Value
- Device UUID

## Implementation Notes

### Connection Management
1. Check device connection before sending commands
2. Support whitelisting for auto-reconnection
3. Monitor connection state changes

### Data Handling
1. Process both raw and calibrated sensor values
2. Queue-based command system
3. Support command queue clearing
4. Handle firmware version compatibility

### Color Operations
1. Verify device connection
2. Support multiple color modes (3 or 4 colors)
3. Handle color transitions with delays

### Error Handling
1. Check connection status
2. Verify command responses
3. Monitor firmware update status
4. Handle disconnection events

## Dependencies
- Bluetooth Low Energy (BLE) 4.0 or higher
- Device running firmware version compatible with protocol

## Version Compatibility
- iOS Deployment Target: 14.0+
- Protocol Version: 1.0
- Minimum Firmware Version: 13.07

## Security Considerations
- Implement proper BLE security measures
- Handle pairing and bonding appropriately
- Protect sensitive device operations

---
*Note: This protocol specification is based on CosmoSDK version 0.13.24* 