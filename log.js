'use strict';

const CurrentDT = () => new Date().toLocaleString('ru');

const ConsoleLog = console.log;
console.log = (message, ...params) => ConsoleLog(`[${CurrentDT()}] ${message}`, ...params);

const ConsoleWarn = console.warn;
console.warn = (message, ...params) => ConsoleWarn(`\x1b[33m[${CurrentDT()}] ${message}\x1b[0m`, ...params);

const ConsoleError = console.error;
console.error = (message, ...params) => ConsoleError(`\x1b[31m[${CurrentDT()}] ${message}\x1b[0m`, ...params);
