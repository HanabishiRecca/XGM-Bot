'use strict';

import Logger from './log.js';

export const Shutdown = (e) => {
    Logger.Error(e);
    Logger.Log('SHUTDOWN');
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

export const {
    TOKEN,
    STORAGE,
    WH_LOG_ID,
    WH_LOG_TOKEN,
    CLIENT_ID,
    AUTH_SVC,
    CLIENT_SECRET,
    REDIRECT_URL,
} = process.env;

const Check = (value, message) => value || Shutdown(message);

Check(TOKEN, 'Bot token required.');
Check(STORAGE, 'Storage path required.');
Check(WH_LOG_ID, 'Log webhook id required.');
Check(WH_LOG_TOKEN, 'Log webhook token required.');
Check(CLIENT_ID, 'Client id required.');
Check(AUTH_SVC, 'Server auth required.');
Check(CLIENT_SECRET, 'Client secret required.');
Check(REDIRECT_URL, 'Redirect URL required.');
