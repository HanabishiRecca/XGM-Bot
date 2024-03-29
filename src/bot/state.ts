import Logger from "../util/log";
import { LoadConfig } from "../util/config";
import Storage from "../util/storage";
import { STORAGE, TOKEN, WH_LOG_ID, WH_LOG_TOKEN } from "./process";
import { Authorization, Actions } from "discord-slim";

export const config = LoadConfig("bot");

const dbPath = `${STORAGE}/users.db`;
export const AuthUsers = Storage.Load<string, number>(dbPath);

export const SaveAuthUsers = () => Storage.Save(AuthUsers, dbPath);

export const FindAuthUser = (value: number) => {
    for (const [k, v] of AuthUsers) if (value == v) return k;
};

export const authorization = new Authorization(TOKEN);

Actions.setDefaultRequestOptions({
    authorization,
    rateLimit: {
        retryCount: 3,
        callback: (response, attempts) =>
            Logger.Warn(
                `${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`,
            ),
    },
});

export const SendLogMsg = (content: string) =>
    Actions.Webhook.Execute(WH_LOG_ID, WH_LOG_TOKEN, { content }).catch(
        Logger.Error,
    );
