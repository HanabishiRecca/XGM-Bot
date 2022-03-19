const DT = () => `[${new Date().toLocaleString('ru')}]`;

export const
    Log = (...params: any[]) => console.log('\x1b[0m', DT(), ...params),
    Warn = (...params: any[]) => console.warn('\x1b[93m', DT(), ...params),
    Error = (...params: any[]) => console.error('\x1b[31m', DT(), ...params);

export default { Log, Warn, Error };
