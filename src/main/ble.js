const windowsBLE = require('./ble-windows');

const getPlatformBLE = () => {
  if (process.platform === 'win32') {
    return windowsBLE;
  }
  throw new Error(`Platform ${process.platform} not supported`);
};

module.exports = getPlatformBLE(); 