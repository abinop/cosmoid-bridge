// Shared constants
module.exports = {
  BLE_SERVICE_UUID: '00001523-1212-efde-1523-785feabcd123',
  BLE_CHARACTERISTICS: {
    SENSOR: '00001524-1212-efde-1523-785feabcd123',
    COMMAND: '00001528-1212-efde-1523-785feabcd123',
    BUTTON_STATUS: '00001525-1212-efde-1523-785feabcd123',
    BATTERY_LEVEL: '00001529-1212-efde-1523-785feabcd123',
    SERIAL_NUMBER: '00001526-1212-efde-1523-785feabcd123' // Add this if it exists in the protocol
  },
  WS_PORT: 8080
};
