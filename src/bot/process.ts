import Logger from '../util/log';

export const Shutdown = (e: any) => {
    Logger.Error(e);
    Logger.Log('SHUTDOWN');
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

export const {
    STORAGE = Shutdown('Storage path required.'),
    TOKEN = Shutdown('Bot token required.'),
    WH_LOG_ID = Shutdown('Log webhook id required.'),
    WH_LOG_TOKEN = Shutdown('Log webhook token required.'),
    AUTH_SVC = Shutdown('Server auth required.'),
    CLIENT_SECRET = Shutdown('Client secret required.'),
    REDIRECT_URL = Shutdown('Redirect URL required.'),
    WH_SYSLOG_ID = Shutdown('System log webhook id required.'),
    WH_SYSLOG_TOKEN = Shutdown('System log webhook token required.'),
} = process.env;
