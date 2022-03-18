'use strict';

import Logger from '../util/log.js';

const Shutdown = (e) => {
    Logger.Error(e);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

export const {
    TOKEN,
    STORAGE,
} = process.env;

const Check = (value, message) => value || Shutdown(message);

Check(TOKEN, 'Bot token required.');
Check(STORAGE, 'Storage path required.');

import Storage from '../util/storage.js';
import config from '../util/config.js';
import { SyncUser, ClearUser } from '../util/users.js';
import { Authorization, Actions } from 'discord-slim';

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
        result = new Map(),
        query = { limit: MEMBERS_REQUEST_LIMIT };

    while(true) {
        const members = await Actions.Guild.ListMembers(config.server, query);

        for(const member of members)
            result.set(member.user.id, member);

        if(members.length < MEMBERS_REQUEST_LIMIT)
            break;

        query.after = members[members.length - 1].user.id;
    }

    return result;
};

const SyncUsers = async (users, members) => {
    const bans = new Set();
    for(const ban of await Actions.Guild.GetBans(config.server))
        bans.add(ban.user.id);

    for(const [id, xgmid] of users)
        await SyncUser(id, xgmid, bans.has(id), members.get(id));
};

const CheckRevoked = async (users, members) => {
    for(const member of members.values())
        if(!users.has(member.user.id))
            await ClearUser(member);
};

(async () => {
    Logger.Log('Users sync job start.');

    Logger.Log('Loading storage...');
    const users = Storage.Load(`${STORAGE}/users.db`);
    Logger.Log(`Authorized users: ${users.size}.`);

    Logger.Log('Fetching members...');
    const members = await FetchMembers();
    Logger.Log(`Member count: ${members.size}.`);

    Logger.Log('Syncing authorized users...');
    await SyncUsers().catch(Logger.Error);

    Logger.Log('Checking for revoked members...');
    await CheckRevoked().catch(Logger.Error);

    Logger.Log('Users sync job end.');
    process.exit();
})();
