const { exec } = require('child_process');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
  }

  async initialize() {
    try {
      const btStatus = await this.runPowerShell(`
        $radio = Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth" -and $_.FriendlyName -like "*Radio*"}
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
        $bluetoothRegistryPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices"
        if (Test-Path $bluetoothRegistryPath) {
          Get-ChildItem $bluetoothRegistryPath | ForEach-Object {
            $devicePath = $_.PSPath
            $deviceName = (Get-ItemProperty $devicePath).Name
            if ($deviceName -like "*Cosmo*") {
              @{
                DeviceID = $_.PSChildName
                Name = $deviceName
                Status = "OK"
                Battery = 100  # Placeholder since we can't get real battery info this way
              }
            }
          }
        } | ConvertTo-Json
      `);

      const devices = JSON.parse(result || '[]');
      if (Array.isArray(devices)) {
        devices.forEach(device => {
          if (device.DeviceID) {
            this.devices.set(device.DeviceID, {
              id: device.DeviceID,
              name: device.Name || 'Unknown Cosmo Device',
              address: device.DeviceID,
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
      exec('powershell.exe -NoProfile -NonInteractive -Command -', 
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
        }).stdin.end(script);
    });
  }
}

module.exports = new BLEManager(); 