const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    
    // Ensure we're getting the correct path and it exists
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : '/var/local');
    this.logPath = path.join(appDataPath, 'Cosmoid Bridge', 'debug.log');
    
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Test log write on startup
    this.log('BLEManager', 'Initialized');
    this.log('Log path', this.logPath);
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage;
    
    try {
      logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
      console.log(logMessage); // Also log to console for immediate feedback
      fs.appendFileSync(this.logPath, logMessage);
    } catch (error) {
      console.error('Logging failed:', error);
      console.error('Attempted to log:', { message, data });
    }
  }

  async startScanning() {
    this.log('startScanning', 'Starting scan...');
    
    if (this.isScanning) {
      this.log('startScanning', 'Already scanning, returning early');
      return;
    }

    this.isScanning = true;
    try {
      // First command: Get paired/known devices
      const pairedCommand = `
        $devices = @(Get-PnpDevice | Where-Object { 
          ($_.Class -eq "BTHLEDevice" -or $_.Class -eq "Bluetooth") -and 
          $_.Present -eq $true
        })
        
        $result = @($devices | ForEach-Object {
          $device = $_
          $devicePath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\" + $device.DeviceID
          
          @{
            DeviceID = $device.DeviceID
            Class = $device.Class
            FriendlyName = $device.FriendlyName
            Description = $device.Description
            Manufacturer = $device.Manufacturer
            Service = $device.Service
            Status = $device.Status
            IsPaired = $true
          }
        })
        
        ConvertTo-Json -InputObject $result -Depth 10
      `;

      // Second command: Look for advertising devices using BluetoothLEAdvertisementWatcher
      const scanCommand = `
        $source = @"
        using System;
        using System.Threading;
        using Windows.Devices.Bluetooth.Advertisement;
        
        public class BLEScanner {
            public static string ScanForDevices(int scanTime = 5) {
                var devices = new System.Collections.Generic.List<object>();
                var watcher = new BluetoothLEAdvertisementWatcher();
                var scanComplete = new ManualResetEvent(false);
                
                // Set active scanning mode
                watcher.ScanningMode = BluetoothLEScanningMode.Active;
                
                watcher.Received += (sender, args) => {
                    var serviceUuids = args.Advertisement.ServiceUuids;
                    var isCosmoDevice = false;
                    
                    // Check for Cosmo service UUID
                    foreach (var uuid in serviceUuids) {
                        if (uuid.ToString().Equals("00001523-1212-efde-1523-785feabcd123", StringComparison.OrdinalIgnoreCase)) {
                            isCosmoDevice = true;
                            break;
                        }
                    }
                    
                    // Check device name
                    if (args.Advertisement.LocalName != null && 
                        args.Advertisement.LocalName.Contains("Cosmo", StringComparison.OrdinalIgnoreCase)) {
                        isCosmoDevice = true;
                    }
                    
                    if (isCosmoDevice) {
                        var device = new {
                            Address = args.BluetoothAddress.ToString("X"),
                            Rssi = args.RawSignalStrengthInDBm,
                            Name = args.Advertisement.LocalName,
                            IsConnectable = args.Advertisement.IsConnectable,
                            Timestamp = DateTime.Now,
                            ServiceUuids = args.Advertisement.ServiceUuids,
                            IsCosmoDevice = true
                        };
                        devices.Add(device);
                    }
                };
                
                watcher.Start();
                scanComplete.WaitOne(scanTime * 1000);
                watcher.Stop();
                
                return System.Text.Json.JsonSerializer.Serialize(devices);
            }
        }
"@
        
        Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @(
            "System.Runtime",
            "System.Collections",
            "System.Text.Json",
            ([System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBuffer].Assembly.Location)
        )
        
        [BLEScanner]::ScanForDevices(5)
      `;

      // Execute commands
      this.log('Executing paired devices query');
      const pairedResult = await this.runPowerShell(pairedCommand);
      this.log('Paired devices raw output', pairedResult);

      this.log('Executing BLE scan');
      const scanResult = await this.runPowerShell(scanCommand);
      this.log('BLE scan raw output', scanResult);

      // Process results
      try {
        const pairedDevices = JSON.parse(pairedResult || '[]');
        const scanningDevices = JSON.parse(scanResult || '[]');
        
        this.log('Parsed paired devices', pairedDevices);
        this.log('Parsed scanning devices', scanningDevices);

        // Clear existing devices
        this.devices.clear();

        // Process paired devices
        pairedDevices.forEach(device => {
          if (device.DeviceID) {
            const isCosmoDevice = 
              device.FriendlyName?.toLowerCase().includes('cosmo') ||
              device.FriendlyName?.toLowerCase().includes('csm') ||
              device.Description?.toLowerCase().includes('cosmo') ||
              device.DeviceID?.toLowerCase().includes('cosmo');

            if (isCosmoDevice || device.Class === 'BTHLEDevice') {
              this.devices.set(device.DeviceID, {
                id: device.DeviceID,
                name: device.FriendlyName || 'Unknown Device',
                address: device.DeviceID.split('\\').pop(),
                connected: device.Status === 'OK',
                class: device.Class,
                manufacturer: device.Manufacturer,
                description: device.Description,
                isPaired: true,
                isAdvertising: false
              });
            }
          }
        });

        // Process advertising devices
        scanningDevices.forEach(device => {
          const deviceId = `BTHLE_${device.Address}`;
          this.devices.set(deviceId, {
            id: deviceId,
            name: device.Name || `Unknown Device (${device.Address})`,
            address: device.Address,
            connected: false,
            class: 'BTHLEDevice',
            rssi: device.Rssi,
            isPaired: false,
            isAdvertising: true,
            serviceUuids: device.ServiceUuids || []
          });
        });

        this.log('Final devices map', Array.from(this.devices.values()));
      } catch (parseError) {
        this.log('JSON Parse Error', parseError.toString());
        this.log('Failed to parse results', { pairedResult, scanResult });
      }
    } catch (error) {
      this.log('Scanning error', error.toString());
      this.log('Error stack', error.stack);
    } finally {
      this.isScanning = false;
      this.log('Scanning complete', 'Scan finished');
    }
  }

  runPowerShell(script) {
    return new Promise((resolve, reject) => {
      this.log('runPowerShell', 'Starting PowerShell execution');
      
      const child = exec('powershell.exe -NoProfile -NonInteractive -Command -', 
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
          this.log('PowerShell stdout', stdout);
          resolve(stdout);
        });

      child.stdin.write(script);
      child.stdin.end();
    });
  }

  // ... rest of the methods ...
}

module.exports = new BLEManager(); 