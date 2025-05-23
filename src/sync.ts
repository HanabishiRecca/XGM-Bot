import Logger from "./util/log";

const Shutdown = (e: any) => {
    Logger.Error(e);
    process.exit(1);
};

process.on("uncaughtException", Shutdown);
process.on("unhandledRejection", Shutdown);

const {
    STORAGE = Shutdown("Storage path required."),
    TOKEN = Shutdown("Bot token required."),
} = process.env;

import Storage from "./util/storage";
import { LoadConfig } from "./util/config";
import { SyncUser, ClearUser } from "./util/users";
import { Authorization, Actions, Types } from "discord-slim";

const MEMBERS_REQUEST_LIMIT = 1000;
const config = LoadConfig("bot");

Actions.setDefaultRequestOptions({
    authorization: new Authorization(TOKEN),
    rateLimit: {
        retryCount: 3,
        callback: (response, attempts) =>
            Logger.Warn(
                `${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`,
            ),
    },
});

const FetchMembers = async () => {
    const result = new Map<string, Types.Member>();
    const query: { limit: number; after?: string } = {
        limit: MEMBERS_REQUEST_LIMIT,
    };

    while (true) {
        const members = await Actions.Guild.ListMembers(config.server, query);
        let last: string | undefined;

        for (const member of members) {
            last = member.user.id;
            result.set(last, member);
        }

        if (!last || members.length < MEMBERS_REQUEST_LIMIT) break;

        query.after = last;
    }

    return result;
};

const SyncUsers = async (
    users: Map<string, number>,
    members: Map<string, Types.Member>,
) => {
    const bans = new Map<string, Types.User>();
    for (const { user } of await Actions.Guild.GetBans(config.server))
        bans.set(user.id, user);

    for (const [id, xgmid] of users) {
        const member = members.get(id);
        const user = bans.get(id);
        if (member) await SyncUser(config.server, member, xgmid, Boolean(user));
        else if (user) await SyncUser(config.server, { user }, xgmid, true);
    }
};

const CheckRevoked = async (
    users: Map<string, number>,
    members: Map<string, Types.Member>,
) => {
    for (const member of members.values())
        if (!users.has(member.user.id)) await ClearUser(config.server, member);
};

(async () => {
    Logger.Debug("Users sync job start.");

    Logger.Debug("Loading storage...");
    const users = Storage.Load<string, number>(`${STORAGE}/users.db`);
    Logger.Info(`Authorized users: ${users.size}.`);

    Logger.Debug("Fetching members...");
    const members = await FetchMembers();
    Logger.Info(`Member count: ${members.size}.`);

    Logger.Debug("Syncing authorized users...");
    await SyncUsers(users, members).catch(Logger.Error);

    Logger.Debug("Checking for revoked members...");
    await CheckRevoked(users, members).catch(Logger.Error);

    Logger.Debug("Users sync job finished.");
})();
