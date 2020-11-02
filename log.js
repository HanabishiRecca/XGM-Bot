'use strict';

const
    util = require('util'),
    CurrentDT = () => new Date().toLocaleString('ru'),
    ToString = value => (typeof value == 'object') ? JSON.stringify(util.inspect(value), null, 4) : value;

const ConsoleLog = console.log;
console.log = (message, ...params) => ConsoleLog(`[${CurrentDT()}] ${ToString(message)}`, ...params);

const ConsoleWarn = console.warn;
console.warn = (message, ...params) => ConsoleWarn(`\x1b[93m[${CurrentDT()}] ${ToString(message)}\x1b[0m`, ...params);

const ConsoleError = console.error;
console.error = (message, ...params) => ConsoleError(`\x1b[31m[${CurrentDT()}] ${ToString(message)}\x1b[0m`, ...params);
