const { platform } = require('os');

function getPlatformRequirements() {
  const currentPlatform = platform();
  
  let bleModule;
  if (currentPlatform === 'win32') {
    bleModule = '@abandonware/noble';  // Explicitly use noble for Windows
  } else if (currentPlatform === 'darwin') {
    bleModule = '@abandonware/noble';  // Use noble for macOS
  } else {
    bleModule = 'node-ble';  // Use node-ble for Linux
  }
  
  return {
    bleModule,
    requiresDBus: currentPlatform !== 'win32' && currentPlatform !== 'darwin'
  };
}

module.exports = {
  getPlatformRequirements
}; 