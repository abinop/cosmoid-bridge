const { rebuild } = require('@electron/rebuild');
const path = require('path');
const fs = require('fs');

async function rebuildNative() {
  console.log('Rebuilding native modules...');
  try {
    // Read package.json to get electron version
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    );
    const electronVersion = packageJson.devDependencies.electron.replace('^', '');
    
    console.log('Rebuilding for Electron version:', electronVersion);
    
    await rebuild({
      buildPath: path.join(__dirname, '..'),
      electronVersion: electronVersion,
      force: true,
      types: ['prod', 'optional']
    });
    
    console.log('Rebuild complete');
  } catch (error) {
    console.error('Rebuild failed:', error);
    process.exit(1);
  }
}

rebuildNative(); 