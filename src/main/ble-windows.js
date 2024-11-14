const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    this.logPath = path.join(process.env.APPDATA, 'Cosmoid Bridge', 'debug.log');
    
    // Ensure log directory exists
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}: ${JSON.stringify(data)}\n`;
    fs.appendFileSync(this.logPath, logMessage);
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
        $devices = Get-PnpDevice | Where-Object {
          $_.Class -eq "Bluetooth" -and 
          $_.Status -eq "OK"
        } | Select-Object DeviceID, FriendlyName, Class, Status, Manufacturer, HardwareID

        $devices | ForEach-Object {
          $_ | Add-Member -MemberType NoteProperty -Name "Details" -Value ($_.HardwareID -join "; ")
        }

        $devices | ConvertTo-Json -Depth 10
      `);

      this.log('All discovered devices', result);

      const devices = JSON.parse(result || '[]');
      if (Array.isArray(devices)) {
        devices.forEach(device => {
          this.log('Device details', {
            name: device.FriendlyName,
            manufacturer: device.Manufacturer,
            details: device.Details
          });

          if (device.FriendlyName && (
              device.FriendlyName.includes('Cosmo') || 
              device.Manufacturer?.includes('Filisia') ||
              device.Details?.includes('Cosmo')
          )) {
            this.devices.set(device.DeviceID, {
              id: device.DeviceID,
              name: device.FriendlyName,
              manufacturer: device.Manufacturer,
              details: device.Details,
              connected: device.Status === 'OK',
              battery: 100
            });
          }
        });
      }
    } catch (error) {
      this.log('Scanning error', error);
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