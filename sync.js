'use strict';

import Logger from './log.js';

const Shutdown = (err) => {
    Logger.Error(err);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

!process.env.TOKEN && Shutdown('Token required.');
!process.env.STORAGE && Shutdown('Storage path required.');

import { Authorization, Actions } from 'discord-slim';
import Storage from './storage.js';
import config from './config.js';
import { SyncUser, ClearUser } from './users.js';

const AuthUsers = Storage.Load(config.storage.users);

const Members = new Map();

const authorization = new Authorization(process.env.TOKEN);

Actions.setDefaultRequestOptions({
    authorization,
    rateLimit: {
        retryCount: 3,
        callback: (response, attempts) =>
            Logger.Warn(`${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`),
    },
});

const SyncUsers = async () => {
    Logger.Log('Syncing authorized users...');
    try {
        const bans = new Set();
        for(const ban of await Actions.Guild.GetBans(config.server))
            bans.add(ban.user.id);

        for(const [id, xgmid] of AuthUsers)
            await SyncUser(id, xgmid, bans.has(id), Members.get(id));
    } catch(e) {
        Logger.Error(e);
    }

    Logger.Log('Checking for revoked members...');
    try {
        for(const member of Members.values())
            if(!AuthUsers.has(member.user.id))
                await ClearUser(member);
    } catch(e) {
        Logger.Error(e);
    }
};

const MEMBERS_REQUEST_LIMIT = 1000;

const FetchMembers = async () => {
    Logger.Log('Fetching members...');

    const query = { limit: MEMBERS_REQUEST_LIMIT };
    while(true) {
        const members = await Actions.Guild.ListMembers(config.server, query);

        for(const member of members)
            Members.set(member.user.id, member);

        if(members.length < MEMBERS_REQUEST_LIMIT)
            break;

        query.after = members[members.length - 1].user.id;
    }

    Logger.Log(`Member count: ${Members.size}.`);
};

(async () => {
    Logger.Log('Users sync job start.');
    Logger.Log(`Authorized users: ${AuthUsers.size}.`);
    await FetchMembers();
    await SyncUsers();
    Logger.Log('Users sync job end.');
    process.exit();
})();
