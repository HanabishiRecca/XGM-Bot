import Logger from '../util/log.js';
import Storage from '../util/storage.js';
import { STORAGE, TOKEN, WH_LOG_ID, WH_LOG_TOKEN } from './process.js';
import { Authorization, Actions, Types } from 'discord-slim';

const dbPath = `${STORAGE}/users.db`;

export const AuthUsers = Storage.Load<string, number>(dbPath);

export const SaveAuthUsers = () =>
    Storage.Save(AuthUsers, dbPath);

export const FindAuthUser = (value: number) => {
    for(const [k, v] of AuthUsers)
        if(value == v)
            return k;
};

type Server = {
    id: string;
    members: Map<string, Types.Member>;
};

const ConnectedServers = new Map<string, Server>();

export const AddServer = ({ id }: Types.Guild) => {
    if(!id) return;
    ConnectedServers.set(id, {
        id,
        members: new Map(),
    });
};

export const GetServer = (id?: string) => {
    if(!id) return;
    return ConnectedServers.get(id);
};

export const RemoveServer = (id?: string) => {
    if(!id) return;
    ConnectedServers.delete(id);
};

export const RemoveAllServers = () =>
    ConnectedServers.clear();

export const authorization = new Authorization(TOKEN);

Actions.setDefaultRequestOptions({
    authorization,
    rateLimit: {
        retryCount: 3,
        callback: (response, attempts) =>
            Logger.Warn(`${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`),
    },
});

export const SendLogMsg = (content: string) =>
    Actions.Webhook.Execute(WH_LOG_ID, WH_LOG_TOKEN, { content }).catch(Logger.Error);
