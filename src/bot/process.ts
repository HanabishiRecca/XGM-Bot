import Logger from "../util/log";

export const Shutdown = (e: unknown, ok?: boolean) => {
    ok ? Logger.Log(e) : Logger.Error(e);
    Logger.Log("SHUTDOWN");
    process.exit(ok ? 0 : 1);
};

process.on("uncaughtException", Shutdown);
process.on("unhandledRejection", Shutdown);

export const {
    STORAGE = Shutdown("Storage path required."),
    TOKEN = Shutdown("Bot token required."),
    WH_LOG_ID = Shutdown("Log webhook id required."),
    WH_LOG_TOKEN = Shutdown("Log webhook token required."),
    AUTH_SVC = Shutdown("Server auth required."),
    SVC_PORT = Shutdown("Server port required."),
    CLIENT_SECRET = Shutdown("Client secret required."),
    REDIRECT_URL = Shutdown("Redirect URL required."),
    WH_SYSLOG_ID = Shutdown("System log webhook id required."),
    WH_SYSLOG_TOKEN = Shutdown("System log webhook token required."),
} = process.env;
