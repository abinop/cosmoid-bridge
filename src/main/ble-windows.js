const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class BLEManager {
  constructor() {
    this.devices = new Map();
    this.isScanning = false;
    
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : '/var/local');
    this.logPath = path.join(appDataPath, 'Cosmoid Bridge', 'debug.log');
    
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.log('BLEManager', 'Initialized');
  }

  log(message, data) {
    const timestamp = new Date().toISOString();
    let logMessage = `${timestamp} - ${message}: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}\n`;
    console.log(logMessage);
    fs.appendFileSync(this.logPath, logMessage);
  }

  async startScanning() {
    if (this.isScanning) {
      this.log('startScanning', 'Already scanning');
      return;
    }

    this.isScanning = true;
    this.devices.clear();

    try {
      const scanCommand = `
        $source = @"
using System;
using System.Threading;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Enumeration;

public class BLEScanner {
    public static string ScanForDevices(int scanTime = 5) {
        var devices = new System.Collections.Generic.List<object>();
        var watcher = new BluetoothLEAdvertisementWatcher();
        var scanComplete = new ManualResetEvent(false);
        
        watcher.ScanningMode = BluetoothLEScanningMode.Active;
        watcher.SignalStrengthFilter.SamplingInterval = TimeSpan.FromMilliseconds(100);
        
        watcher.Received += async (sender, args) => {
            try {
                var deviceInfo = await BluetoothLEDevice.FromBluetoothAddressAsync(args.BluetoothAddress);
                if (deviceInfo != null) {
                    var name = args.Advertisement.LocalName;
                    if (!string.IsNullOrEmpty(name) && name.Contains("Cosmo", StringComparison.OrdinalIgnoreCase)) {
                        var device = new {
                            Id = deviceInfo.DeviceId,
                            Name = name,
                            Address = args.BluetoothAddress.ToString("X"),
                            Rssi = args.RawSignalStrengthInDBm,
                            IsConnectable = args.Advertisement.IsConnectable,
                            IsCosmoDevice = true
                        };
                        
                        if (!devices.Exists(d => d.Address == device.Address)) {
                            devices.Add(device);
                            Console.WriteLine($"Found Cosmo device: {name}");
                        }
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine($"Error processing device: {ex.Message}");
            }
        };
        
        watcher.Start();
        Console.WriteLine("Scanning started...");
        scanComplete.WaitOne(scanTime * 1000);
        watcher.Stop();
        
        return System.Text.Json.JsonSerializer.Serialize(devices);
    }
}
"@
        
        Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @(
            "System.Runtime",
            "System.Collections",
            "System.Text.Json"
        )
        
        [BLEScanner]::ScanForDevices(5)
      `;

      this.log('Executing BLE scan');
      const scanResult = await this.runPowerShell(scanCommand);
      this.log('Scan raw output', scanResult);

      try {
        const discoveredDevices = JSON.parse(scanResult || '[]');
        discoveredDevices.forEach(device => {
          if (device.IsCosmoDevice) {
            this.devices.set(device.Id, {
              id: device.Id,
              name: device.Name,
              address: device.Address,
              rssi: device.Rssi,
              isConnectable: device.IsConnectable,
              isConnected: false,
              isCosmoDevice: true
            });
          }
        });

        this.log('Discovered Cosmo devices', Array.from(this.devices.values()));
      } catch (parseError) {
        this.log('JSON Parse Error', parseError.toString());
        this.log('Failed to parse scan results', scanResult);
      }
    } catch (error) {
      this.log('Scanning error', error.toString());
      this.log('Error stack', error.stack);
    } finally {
      this.isScanning = false;
    }
  }

  runPowerShell(script) {
    return new Promise((resolve, reject) => {
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
          resolve(stdout);
        });

      child.stdin.write(script);
      child.stdin.end();
    });
  }
}

module.exports = new BLEManager(); 