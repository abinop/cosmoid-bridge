const { exec } = require('child_process');
const path = require('path');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
  }

  async initialize() {
    try {
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
        $devices = Get-PnpDevice | Where-Object {
          $_.Name -like "*Cosmo*" -and 
          $_.Class -eq "Bluetooth" -and 
          $_.Status -eq "OK" -and 
          $_.Present -eq $true
        }
        
        $deviceList = @()
        foreach ($device in $devices) {
          $batteryInfo = Get-WmiObject -Class Win32_Battery | Where-Object { $_.Name -like "*$($device.FriendlyName)*" }
          $batteryLevel = if ($batteryInfo) { $batteryInfo.EstimatedChargeRemaining } else { 0 }
          
          $deviceInfo = @{
            DeviceID = $device.DeviceID
            Name = $device.FriendlyName
            Status = $device.Status
            Battery = $batteryLevel
          }
          $deviceList += $deviceInfo
        }
        
        ConvertTo-Json -InputObject $deviceList
      `);

      const devices = JSON.parse(result || '[]');
      if (Array.isArray(devices)) {
        devices.forEach(device => {
          if (device.DeviceID) {
            this.devices.set(device.DeviceID, {
              id: device.DeviceID,
              name: device.Name || 'Unknown Cosmo Device',
              address: device.DeviceID.split('\\').pop(),
              connected: device.Status === 'OK',
              battery: device.Battery
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

module.exports = new BLEManager(); 