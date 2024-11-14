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
      this.log('startScanning', 'Executing PowerShell commands');
      
      // First command: Get paired/known devices
      const pairedCommand = `
        Write-Output "Getting paired devices..."
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
        
        $result | ConvertTo-Json -Depth 10
      `;

      // Second command: Look for advertising devices
      const scanCommand = `
        Write-Output "Scanning for advertising devices..."
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 })[0]
        
        Function Await($WinRtTask, $ResultType) {
            $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
            $netTask = $asTask.Invoke($null, @($WinRtTask))
            $netTask.Wait(-1) | Out-Null
            $netTask.Result
        }
        
        [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] | Out-Null
        
        $aqsFilter = "System.Devices.Aep.ProtocolId:={bb7bb05e-5972-42b5-94fc-76eaa7084d49}"
        $deviceInfos = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($aqsFilter)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
        
        $result = @($deviceInfos | ForEach-Object {
            @{
                DeviceID = $_.Id
                Class = "BTHLEDevice"
                FriendlyName = $_.Name
                Description = "Advertising BLE Device"
                Status = "Available"
                IsPaired = $false
                IsAdvertising = $true
            }
        })
        
        $result | ConvertTo-Json -Depth 10
      `;

      // Execute both commands
      const [pairedResult, scanResult] = await Promise.all([
        this.runPowerShell(pairedCommand),
        this.runPowerShell(scanCommand)
      ]);

      this.log('PowerShell paired devices output', pairedResult);
      this.log('PowerShell scan output', scanResult);

      // Process results
      try {
        const pairedDevices = JSON.parse(pairedResult || '[]');
        const scanningDevices = JSON.parse(scanResult || '[]');
        const allDevices = [...(Array.isArray(pairedDevices) ? pairedDevices : [pairedDevices]),
                           ...(Array.isArray(scanningDevices) ? scanningDevices : [scanningDevices])];
        
        this.log('All discovered devices', allDevices);
        
        allDevices.forEach(device => {
          if (device.DeviceID) {
            // Look for potential Cosmo devices
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
                isPaired: device.IsPaired,
                isAdvertising: device.IsAdvertising
              });
            }
          }
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