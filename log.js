'use strict';

const CurrentDT = () => new Date().toLocaleString('ru');

const ConsoleLog = console.log;
console.log = (...params) => ConsoleLog(`[${CurrentDT()}]`, ...params);

const ConsoleWarn = console.warn;
console.warn = (...params) => ConsoleWarn('\x1b[93m', `[${CurrentDT()}]`, ...params, '\x1b[0m');

const ConsoleError = console.error;
console.error = (...params) => ConsoleError('\x1b[31m', `[${CurrentDT()}]`, ...params, '\x1b[0m');
