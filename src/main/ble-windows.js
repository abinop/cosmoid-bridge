const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    this.logPath = path.join(process.env.APPDATA, 'Cosmoid Bridge', 'debug.log');
    
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
        $radio = Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}
        if ($radio.Status -eq 'OK') { Write-Output 'enabled' } else { Write-Output 'disabled' }
      `);

      if (btStatus.trim() !== 'enabled') {
        throw new Error('Bluetooth is not enabled');
      }

      return this;
    } catch (error) {
      this.log('Initialize error', error);
      throw error;
    }
  }

  async startScanning() {
    if (this.isScanning) return;

    this.isScanning = true;
    try {
      const result = await this.runPowerShell(`
        $devices = @(Get-PnpDevice -Class Bluetooth -PresentOnly | Where-Object { 
          $_.Status -eq "OK" -and 
          ($_.Service -eq "BthLEEnum" -or $_.Service -eq "BTHLE")
        } | Select-Object DeviceID, FriendlyName, Description, Manufacturer, Service, Status)
        if ($devices.Count -eq 0) {
          Write-Output "No BLE devices found"
        } else {
          $devices | ConvertTo-Json
        }
      `);

      this.log('Raw PowerShell output', result);

      if (result.includes("No BLE devices found")) {
        this.log('No devices found', null);
        return;
      }

      const devices = JSON.parse(result || '[]');
      const deviceArray = Array.isArray(devices) ? devices : [devices];
      
      deviceArray.forEach(device => {
        this.log('Found device', device);
        if (device.DeviceID) {
          this.devices.set(device.DeviceID, {
            id: device.DeviceID,
            name: device.FriendlyName || 'Unknown Device',
            address: device.DeviceID.split('\\').pop(),
            connected: device.Status === 'OK'
          });
        }
      });

      this.log('Final devices list', Array.from(this.devices.values()));
    } catch (error) {
      this.log('Scanning error', error.toString());
      this.log('Scanning error stack', error.stack);
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
            this.log('PowerShell Error', error);
            reject(error);
            return;
          }
          if (stderr) {
            this.log('PowerShell stderr', stderr);
          }
          resolve(stdout);
        }).stdin.end(script);
    });
  }
}

module.exports = new BLEManager(); 