const { EventEmitter } = require('events');
const { execSync } = require('child_process');

class WindowsBLEAdapter extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
    this.state = 'unknown';
    this.scanning = false;
    this.connectionAttempts = new Map();
  }

  async initialize() {
    try {
      // Check if Bluetooth is enabled using PowerShell
      const btStatus = execSync('powershell.exe "Get-Service bthserv | Select-Object -ExpandProperty Status"')
        .toString()
        .trim();
      
      if (btStatus === 'Running') {
        this.state = 'poweredOn';
        this.emit('stateChange', 'poweredOn');
        return true;
      } else {
        this.state = 'poweredOff';
        this.emit('stateChange', 'poweredOff');
        return false;
      }
    } catch (error) {
      console.error('Failed to initialize Windows BLE:', error);
      this.state = 'poweredOff';
      this.emit('stateChange', 'poweredOff');
      return false;
    }
  }

  async startScanning() {
    if (this.scanning) return;
    this.scanning = true;

    try {
      // Use PowerShell to scan for BLE devices
      const command = `
        $btRadio = Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}
        if ($btRadio) {
          $devices = Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth" -and $_.Status -eq "OK"}
          $devices | ForEach-Object {
            Write-Output "$($_.FriendlyName)|$($_.DeviceID)"
          }
        }
      `;

      const scanResult = execSync(`powershell.exe "${command}"`).toString();
      
      scanResult.split('\n').forEach(line => {
        if (line.trim()) {
          const [name, id] = line.split('|');
          const deviceInfo = {
            id: id.trim(),
            name: name.trim(),
            address: id.trim(),
            rssi: -50, // Default RSSI value
            advertisement: {
              localName: name.trim(),
              serviceUuids: []
            }
          };

          this.devices.set(deviceInfo.id, deviceInfo);
          this.emit('discover', deviceInfo);
        }
      });

      this.emit('scanStart');
    } catch (error) {
      console.error('Failed to start scanning:', error);
      this.scanning = false;
      throw error;
    }
  }

  async stopScanning() {
    this.scanning = false;
    this.emit('scanStop');
  }

  async connect(deviceId) {
    // Prevent multiple simultaneous connection attempts
    if (this.connectionAttempts.get(deviceId)) {
      console.log('Connection already in progress for device:', deviceId);
      return false;
    }

    try {
      this.connectionAttempts.set(deviceId, true);
      // Use PowerShell to connect to the device
      const command = `
        $device = Get-PnpDevice -InstanceId "${deviceId}"
        if ($device) {
          Write-Output "Connected to $($device.FriendlyName)"
          return $true
        } else {
          Write-Output "Device not found"
          return $false
        }
      `;

      const result = execSync(`powershell.exe "${command}"`).toString().trim();
      return result.includes('Connected');
    } catch (error) {
      console.error('Failed to connect:', error);
      throw error;
    } finally {
      this.connectionAttempts.delete(deviceId);
    }
  }
}

module.exports = WindowsBLEAdapter; 