// scripts/build.js
const { build } = require('electron-builder');
const path = require('path');

async function buildApp() {
  try {
    await build({
      config: {
        directories: {
          output: path.join(process.cwd(), 'dist'),
          app: process.cwd()
        },
        files: [
          'src/**/*',
          'assets/**/*',
          'package.json'
        ],
        mac: {
          icon: 'assets/icon.icns',
          category: 'public.app-category.utilities',
          target: ['dmg', 'zip'],
          darkModeSupport: true,
          hardenedRuntime: true,
          gatekeeperAssess: false,
        },
        win: {
          icon: 'assets/icon.ico',
          target: ['nsis'],
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
        },
        linux: {
          icon: 'assets/icon.png',
          target: ['AppImage', 'deb'],
          category: 'Utility',
        }
      }
    });
    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildApp();