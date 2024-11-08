const logger = require('../utils/logger');

this.ws.onmessage = (event) => {
  try {
    logger.log('WebSocket received', event.data);
    const data = JSON.parse(event.data);
    if (data.type === 'devicesList') {
      logger.log('Received devices list', data);
      this.connectedDevices = data.devices || [];
    }
    this.notifyListeners(data.type || 'message', data);
  } catch (error) {
    logger.log('Error parsing WebSocket message', error.message);
    console.error('Error parsing WebSocket message:', error);
  }
};

this.ws.onopen = () => {
  logger.log('WebSocket Connected');
  console.log('WebSocket Connected');
  this.isConnecting = false;
  this.reconnectAttempts = 0;
  this.connectionState = true;
  this.notifyListeners('connected', null);
  this.send({ type: 'getDevices' });
};

this.ws.onclose = () => {
  logger.log('WebSocket Disconnected');
  console.log('WebSocket Disconnected');
  this.isConnecting = false;
  this.connectionState = false;
  this.notifyListeners('disconnected', null);
  this.attemptReconnect();
};

this.ws.onerror = (error) => {
  logger.log('WebSocket Error', error);
  console.error('WebSocket Error:', error);
  this.isConnecting = false;
  this.notifyListeners('connectionFailed', { message: 'Connection failed' });
}; 