import Logger from '../util/log.js';

const Shutdown = (e: any) => {
    Logger.Error(e);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

const {
    STORAGE = Shutdown('Storage path required.'),
    TOKEN = Shutdown('Bot token required.'),
} = process.env;

import Storage from '../util/storage.js';
import config from '../util/config.js';
import { SyncUser, ClearUser } from '../util/users.js';
import { Authorization, Actions, Types } from 'discord-slim';

const MEMBERS_REQUEST_LIMIT = 1000;

Actions.setDefaultRequestOptions({
    authorization: new Authorization(TOKEN),
    rateLimit: {
        retryCount: 3,
        callback: (response, attempts) =>
            Logger.Warn(`${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`),
    },
});

const FetchMembers = async () => {
    const
        result = new Map<string, Types.Member>(),
        query: { limit: number; after?: string; } = { limit: MEMBERS_REQUEST_LIMIT };

    while(true) {
        const members = await Actions.Guild.ListMembers(config.server, query);

        for(const member of members)
            result.set(member.user!.id, member);

        if(members.length < MEMBERS_REQUEST_LIMIT)
            break;

        query.after = members[members.length - 1].user!.id;
    }

    return result;
};

const SyncUsers = async (users: Map<string, number>, members: Map<string, Types.Member>) => {
    const bans = new Map<string, Types.User>();
    for(const { user } of await Actions.Guild.GetBans(config.server))
        bans.set(user.id, user);

    for(const [id, xgmid] of users) {
        const
            member = members.get(id),
            user = bans.get(id);

        if(member)
            await SyncUser(member, xgmid, Boolean(user));
        else if(user)
            await SyncUser({ user }, xgmid, true);
    }
};

const CheckRevoked = async (users: Map<string, number>, members: Map<string, Types.Member>) => {
    for(const member of members.values())
        if(!users.has(member.user!.id))
            await ClearUser(member);
};

(async () => {
    Logger.Log('Users sync job start.');

    Logger.Log('Loading storage...');
    const users = Storage.Load<string, number>(`${STORAGE}/users.db`);
    Logger.Log(`Authorized users: ${users.size}.`);

    Logger.Log('Fetching members...');
    const members = await FetchMembers();
    Logger.Log(`Member count: ${members.size}.`);

    Logger.Log('Syncing authorized users...');
    await SyncUsers(users, members).catch(Logger.Error);

    Logger.Log('Checking for revoked members...');
    await CheckRevoked(users, members).catch(Logger.Error);

    Logger.Log('Users sync job finished.');
    process.exit();
})();
