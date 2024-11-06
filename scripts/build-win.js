const builder = require('electron-builder');
const Platform = builder.Platform;

async function buildWin() {
  try {
    await builder.build({
      targets: Platform.WINDOWS.createTarget(),
      config: {
        npmRebuild: false,
        buildDependenciesFromSource: false,
        win: {
          target: [
            {
              target: 'portable',
              arch: ['x64']
            }
          ],
          artifactName: '${productName}-${version}-portable.exe'
        },
        portable: {
          requestExecutionLevel: 'highest'
        },
        files: [
          "src/**/*",
          "assets/**/*",
          "package.json"
        ],
        extraResources: [
          {
            "from": "node_modules/@abandonware/noble/build/Release/",
            "to": "./",
            "filter": ["*.node"]
          }
        ]
      }
    });
    console.log('Build completed successfully');
  } catch (error) {
    console.error('Error during build:', error);
    process.exit(1);
  }
}

buildWin(); 