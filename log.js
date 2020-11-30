'use strict';

const CurrentDT = () => `[${new Date().toLocaleString('ru')}]`;

const ConsoleLog = console.log;
console.log = (...params) => ConsoleLog('\x1b[0m', CurrentDT(), ...params);

const ConsoleWarn = console.warn;
console.warn = (...params) => ConsoleWarn('\x1b[93m', CurrentDT(), ...params);

const ConsoleError = console.error;
console.error = (...params) => ConsoleError('\x1b[31m', CurrentDT(), ...params);
