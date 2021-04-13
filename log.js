'use strict';

const CurrentDT = () => `[${new Date().toLocaleString('ru')}]`;

export const Log = (...params) => console.log('\x1b[0m', CurrentDT(), ...params);
export const Warn = (...params) => console.warn('\x1b[93m', CurrentDT(), ...params);
export const Error = (...params) => console.error('\x1b[31m', CurrentDT(), ...params);

export default { Log, Warn, Error };
