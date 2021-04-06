'use strict';

const CurrentDT = () => `[${new Date().toLocaleString('ru')}]`;

exports.Log = (...params) => console.log('\x1b[0m', CurrentDT(), ...params);
exports.Warn = (...params) => console.warn('\x1b[93m', CurrentDT(), ...params);
exports.Error = (...params) => console.error('\x1b[31m', CurrentDT(), ...params);
