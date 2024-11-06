// scripts/build.js
const builder = require('electron-builder');
const Platform = builder.Platform;

async function build() {
  try {
    await builder.build({
      targets: Platform.WINDOWS.createTarget(),
      config: {
        appId: 'com.filisia.cosmoidbridge',
        productName: 'Cosmoid Bridge',
        asar: true,
        extraResources: [
          {
            from: 'node_modules/@abandonware/noble/build/Release/',
            to: 'noble-bindings',
            filter: ['*.node']
          }
        ],
        win: {
          target: [
            {
              target: 'nsis',
              arch: ['x64']
            },
            {
              target: 'zip',
              arch: ['x64']
            }
          ],
          icon: 'assets/icon.ico'
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
          shortcutName: 'Cosmoid Bridge'
        }
      }
    });
    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();