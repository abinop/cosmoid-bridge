const { exec } = require('child_process');
const path = require('path');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    this.powershellPath = path.join(__dirname, 'ble-scanner.ps1');
  }

  async initialize() {
    try {
      // Check if Bluetooth is enabled using PowerShell
      const btStatus = await this.runPowerShell(`
        $radio = Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}
        if ($radio.Status -eq 'OK') { Write-Output 'enabled' } else { Write-Output 'disabled' }
      `);

      if (btStatus.trim() !== 'enabled') {
        throw new Error('Bluetooth is not enabled');
      }

      return this;
    } catch (error) {
      console.error('Failed to initialize BLE:', error);
      throw error;
    }
  }

  async startScanning() {
    if (this.isScanning) return;

    this.isScanning = true;
    try {
      const result = await this.runPowerShell(`
        $btRadio = Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}
        $devices = Get-PnpDevice | Where-Object {
          $_.Class -eq "Bluetooth" -and 
          $_.Status -eq "OK" -and 
          $_.Present -eq $true
        }
        $devices | ConvertTo-Json
      `);

      const devices = JSON.parse(result);
      if (Array.isArray(devices)) {
        devices.forEach(device => {
          if (device.DeviceID) {
            this.devices.set(device.DeviceID, {
              id: device.DeviceID,
              name: device.FriendlyName || 'Unknown Device',
              address: device.DeviceID.split('\\').pop(),
              connected: device.Status === 'OK'
            });
          }
        });
      }
    } catch (error) {
      console.error('Scanning error:', error);
    } finally {
      this.isScanning = false;
    }
  }

  async stopScanning() {
    this.isScanning = false;
  }

  async getDevices() {
    return Array.from(this.devices.values());
  }

  async isBluetoothAvailable() {
    try {
      const result = await this.runPowerShell(`
        $radio = Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}
        if ($radio) { Write-Output 'true' } else { Write-Output 'false' }
      `);
      return result.trim() === 'true';
    } catch (error) {
      console.error('Error checking Bluetooth availability:', error);
      return false;
    }
  }

  runPowerShell(script) {
    return new Promise((resolve, reject) => {
      const ps = exec('powershell.exe -NoProfile -NonInteractive -Command -', 
        { shell: true }, 
        (error, stdout, stderr) => {
          if (error) {
            console.error('PowerShell Error:', error);
            reject(error);
            return;
          }
          if (stderr) {
            console.error('PowerShell stderr:', stderr);
          }
          resolve(stdout);
        });

      ps.stdin.write(script);
      ps.stdin.end();
    });
  }
}

// Create a singleton instance with error handling
let bleManager = null;
try {
  bleManager = new BLEManager();
} catch (error) {
  console.error('Failed to create BLE Manager:', error);
  // Return a dummy manager that reports Bluetooth as unavailable
  bleManager = {
    initialize: async () => { throw new Error('BLE not available'); },
    startScanning: async () => [],
    stopScanning: async () => {},
    getDevices: async () => [],
    isBluetoothAvailable: async () => false
  };
}

module.exports = bleManager; 