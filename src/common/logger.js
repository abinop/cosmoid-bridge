const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    this.logFile = path.join(
      app.getPath('userData'),
      'logs',
      `app-${new Date().toISOString().split('T')[0]}.log`
    );

    // Ensure logs directory exists
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  _write(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');

    const logEntry = `[${timestamp}] [${level}] ${message}\n`;

    // Write to file
    fs.appendFileSync(this.logFile, logEntry);

    // Also log to console
    console[level.toLowerCase()](timestamp, message);
  }

  info(...args) {
    this._write('INFO', ...args);
  }

  error(...args) {
    this._write('ERROR', ...args);
  }

  warn(...args) {
    this._write('WARN', ...args);
  }

  debug(...args) {
    this._write('DEBUG', ...args);
  }

  getLogPath() {
    return this.logFile;
  }
}

const logger = new Logger();
module.exports = logger; 