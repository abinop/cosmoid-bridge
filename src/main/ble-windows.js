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
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { 
            $_.Name -eq 'AsTask' -and 
            $_.GetParameters().Count -eq 1 -and 
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' 
        })[0]

        Function Await($WinRtTask, $ResultType) {
            $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
            $netTask = $asTask.Invoke($null, @($WinRtTask))
            $netTask.Wait(-1) | Out-Null
            $netTask.Result
        }

        [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] | Out-Null

        Write-Host "Starting BLE device scan..."
        
        # First, get advertising devices
        $aqsAllDevices = "System.Devices.Aep.ProtocolId:=""{bb7bb05e-5972-42b5-94fc-76eaa7084d49}"""
        $requestedProperties = @(
            "System.Devices.Aep.DeviceAddress",
            "System.Devices.Aep.IsConnected",
            "System.Devices.Aep.Bluetooth.Le.IsConnectable",
            "System.Devices.Aep.SignalStrength",
            "System.Devices.Aep.Manufacturer",
            "System.Devices.Aep.ModelName",
            "System.Devices.Aep.ModelId"
        )

        Write-Host "Scanning for advertising devices..."
        $deviceInfos = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync(
            $aqsAllDevices, 
            $requestedProperties,
            [Windows.Devices.Enumeration.DeviceInformationKind]::AssociationEndpoint
        )) ([Windows.Devices.Enumeration.DeviceInformationCollection])

        $devices = @()
        foreach ($dev in $deviceInfos) {
            Write-Host "Found device: $($dev.Name)"
            $deviceInfo = @{
                Id = $dev.Id
                Name = $dev.Name
                Kind = $dev.Kind.ToString()
                IsEnabled = $dev.IsEnabled
                Properties = @{}
            }

            foreach ($prop in $dev.Properties.GetEnumerator()) {
                $deviceInfo.Properties[$prop.Key] = $prop.Value
            }

            $devices += $deviceInfo
        }

        # Then get paired devices
        Write-Host "Getting paired devices..."
        Get-PnpDevice | Where-Object { 
            ($_.Class -eq "Bluetooth" -or $_.Class -eq "BTHLEDevice") -and 
            $_.Present -eq $true 
        } | ForEach-Object {
            Write-Host "Found paired device: $($_.FriendlyName)"
            $device = $_
            $devicePath = "HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\" + $device.DeviceID
            
            try {
                $deviceInfo = Get-ItemProperty -Path $devicePath -ErrorAction SilentlyContinue
                $hardwareIds = (Get-ItemProperty -Path $devicePath -Name "HardwareID" -ErrorAction SilentlyContinue).HardwareID
                
                $devices += @{
                    Name = $device.FriendlyName
                    Id = $device.DeviceID
                    Class = $device.Class
                    Description = $device.Description
                    Status = $device.Status
                    HardwareIds = $hardwareIds
                    IsPaired = $true
                }
            } catch {
                Write-Host "Error getting device info: $_"
            }
        }

        Write-Host "Scan complete. Converting to JSON..."
        ConvertTo-Json -InputObject $devices -Depth 10
      `;

      this.log('Executing BLE scan');
      const scanResult = await this.runPowerShell(scanCommand);
      this.log('Scan raw output', scanResult);

      try {
        const devices = JSON.parse(scanResult || '[]');
        
        // Log all devices first
        this.log('All discovered devices', devices);

        (Array.isArray(devices) ? devices : [devices]).forEach(device => {
          // Log each device individually for debugging
          this.log('Processing device', {
            name: device.Name,
            id: device.Id,
            properties: device.Properties
          });

          const isCosmoDevice = 
            (device.Name && device.Name.toLowerCase() === 'cosmo') || // Exact match
            (device.Description && device.Description.toLowerCase().includes('cosmo')) ||
            (device.Properties && device.Properties['System.Devices.Aep.ModelName'] === 'Cosmo');

          if (isCosmoDevice) {
            const deviceId = device.Id;
            this.devices.set(deviceId, {
              id: deviceId,
              name: device.Name || 'Unknown Cosmo Device',
              description: device.Description,
              status: device.Status,
              class: device.Class,
              isPaired: !!device.IsPaired,
              isConnectable: device.Properties?.['System.Devices.Aep.Bluetooth.Le.IsConnectable'] || false,
              signalStrength: device.Properties?.['System.Devices.Aep.SignalStrength'],
              address: device.Properties?.['System.Devices.Aep.DeviceAddress'],
              hardwareIds: device.HardwareIds
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