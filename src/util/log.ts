const DT = () => {
    const str = new Date().toISOString();
    return `[${str.slice(0, 10)} ${str.slice(11, -1)}]`;
};

const { CUSTOM_LOG } = process.env;

export const Log = CUSTOM_LOG
    ? (...params: unknown[]) => console.log("\x1b[0m", DT(), ...params)
    : console.log;

export const Warn = CUSTOM_LOG
    ? (...params: unknown[]) => console.warn("\x1b[93m", DT(), ...params)
    : console.warn;

export const Error = CUSTOM_LOG
    ? (...params: unknown[]) => console.error("\x1b[31m", DT(), ...params)
    : console.error;

export default { Log, Warn, Error };
