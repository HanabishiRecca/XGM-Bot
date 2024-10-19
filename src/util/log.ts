export default {
    Error(...params: unknown[]) {
        console.error("<3>", ...params);
    },

    Warn(...params: unknown[]) {
        console.warn("<4>", ...params);
    },

    Log(...params: unknown[]) {
        console.log("<5>", ...params);
    },

    Info(...params: unknown[]) {
        console.info("<6>", ...params);
    },

    Debug(...params: unknown[]) {
        console.debug("<7>", ...params);
    },
};
