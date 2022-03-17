'use strict';

import Logger from './log.js';

const Shutdown = (err) => {
    Logger.Error(err);
    Logger.Log('SHUTDOWN');
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

!process.env.TOKEN && Shutdown('Token required.');
!process.env.STORAGE && Shutdown('Storage path required.');

import { Client, ClientEvents, Authorization, Events, Actions, Helpers, Tools } from 'discord-slim';
import Storage from './storage.js';
import { HttpsGet, ReadIncomingData } from './misc.js';
import config from './config.js';

const dbPath = `${process.env.STORAGE}/users.db`;

const AuthUsers = Storage.Load(dbPath);

const SaveAuthUsers = () =>
    Storage.Save(AuthUsers, dbPath);

const FindAuthUser = (value) => {
    for(const [k, v] of AuthUsers)
        if(value == v)
            return k;
};

const authorization = new Authorization(process.env.TOKEN);

Actions.setDefaultRequestOptions({
    authorization,
    rateLimit: {
        retryCount: 3,
        callback: (response, attempts) =>
            Logger.Warn(`${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`),
    },
});

const client = new Client();

client.on(ClientEvents.CONNECT, () => Logger.Log('Connection established.'));
client.on(ClientEvents.DISCONNECT, (code) => Logger.Error(`Disconnect. (${code})`));
client.on(ClientEvents.WARN, Logger.Warn);
client.on(ClientEvents.ERROR, Logger.Error);
client.on(ClientEvents.FATAL, Shutdown);

const
    GenXgmUserLink = (xgmid) => `https://xgm.guru/user/${xgmid}`,
    GetUserCreationDate = (user_id) => Number(BigInt(user_id) >> 22n) + 1420070400000,
    HasRole = (member, role_id) => member.roles.indexOf(role_id) > -1,
    IsInProject = (status) => status && ((status == 'leader') || (status == 'moderator') || (status == 'active'));

const MarkMessages = (() => {
    const msgs = new Map();
    for(const mark of config.marks)
        msgs.has(mark.message) ?
            msgs.get(mark.message).marks.push(mark) :
            msgs.set(mark.message, { id: mark.message, channel: mark.channel, marks: [mark] });
    return msgs;
})();

const ReactionProc = (reaction, add) => {
    const msg = MarkMessages.get(reaction.message_id);
    if(!msg) return;

    const mark = msg.marks.find((elem) => elem.emoji == reaction.emoji.id);
    if(!mark) return;

    (add ? Actions.Member.AddRole : Actions.Member.RemoveRole)
        (reaction.guild_id, reaction.user_id, mark.role).catch(Logger.Error);
};

const SetMarks = (() => {
    let marksSynced = false;
    return async (serverEmojis) => {
        if(marksSynced) return;
        marksSynced = true;

        const emojiMap = new Map();
        for(const emoji of serverEmojis)
            emojiMap.set(emoji.id, emoji);

        for(const msg of MarkMessages.values()) {
            const message = await Actions.Message.Get(msg.channel, msg.id).catch(Logger.Error);
            if(!message) continue;

            for(const mark of msg.marks) {
                if(message.reactions.find((elem) => elem.emoji.id == mark.emoji)) continue;
                await Actions.Reaction.Add(message.channel_id, message.id, Tools.Format.Reaction(emojiMap.get(mark.emoji))).catch(Logger.Error);
            }
        }
    };
})();

const ConnectedServers = new Map();

const RoleSwitch = async (member, role, enable) => {
    if(!(member && role)) return;

    const f = enable ?
        (HasRole(member, role) ? null : Actions.Member.AddRole) :
        (HasRole(member, role) ? Actions.Member.RemoveRole : null);

    await f?.(config.server, member.user.id, role);
};

const RequestXgmUser = async (xgmid) => {
    let data;
    try {
        data = await HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`);
    } catch(e) {
        if(e.statusCode == 404) {
            Logger.Warn(`XGM user id not found: ${xgmid}`);
            return {};
        }
        throw e;
    }
    return JSON.parse(data);
};

const SyncUser = async (userid, xgmid, banned) => {
    if(userid == client.user.id) return;

    const { info, state } = await RequestXgmUser(xgmid);
    if(!(info && state)) return;

    const
        status = state.access?.staff_status,
        member = ConnectedServers.get(config.server)?.members.get(userid);

    if(status == 'suspended') {
        if(member || !banned)
            await Actions.Ban.Add(config.server, userid);
        return;
    }

    if(!member) {
        if(banned)
            await Actions.Ban.Remove(config.server, userid);
        return;
    }

    await RoleSwitch(member, config.role.readonly, status == 'readonly');
    await RoleSwitch(member, config.role.user, true);
    await RoleSwitch(member, config.role.staff, IsInProject(status));
    await RoleSwitch(member, config.role.team, IsInProject(state.projects?.['833']?.status));
    await RoleSwitch(member, config.role.twilight, info.user?.seeTwilight);
};

const ClearUser = async (member) => {
    await RoleSwitch(member, config.role.readonly, false);
    await RoleSwitch(member, config.role.user, false);
    await RoleSwitch(member, config.role.staff, false);
    await RoleSwitch(member, config.role.team, false);
    await RoleSwitch(member, config.role.twilight, false);
};

const SyncUsers = async () => {
    const members = ConnectedServers.get(config.server)?.members;
    if(!members) return Logger.Warn('No server members! Something wrong?');

    try {
        const bans = new Set();
        for(const ban of await Actions.Guild.GetBans(config.server))
            bans.add(ban.user.id);

        for(const [id, xgmid] of AuthUsers)
            await SyncUser(id, xgmid, bans.has(id));
    } catch(e) {
        Logger.Error(e);
    }

    try {
        for(const member of members.values())
            if(!AuthUsers.has(member?.user.id))
                await ClearUser(member);
    } catch(e) {
        Logger.Error(e);
    }
};

const RunSync = (() => {
    let syncing = false;
    return async () => {
        if(syncing) return;
        syncing = true;

        Logger.Log('Users sync start...');
        await SyncUsers().catch(Logger.Error);
        Logger.Log('Users sync end.');
        global.gc?.();

        syncing = false;
    };
})();

setInterval(RunSync, 3600000);

const CheckUser = (id, flag) => {
    const xgmid = AuthUsers.get(id);
    xgmid && SyncUser(id, xgmid, flag).catch(Logger.Error);
};

const GenMap = (arr) => {
    const map = new Map();
    if(Array.isArray(arr))
        for(const elem of arr)
            map.set(elem.id, elem);
    return map;
};

const AddServer = (server) =>
    ConnectedServers.set(server.id, {
        id: server.id,
        roles: GenMap(server.roles),
        members: new Map(),
        channels: GenMap(server.channels),
    });

const WH_LOG_ID = process.env.WH_LOG_ID, WH_LOG_TOKEN = process.env.WH_LOG_TOKEN;

const SendLogMsg = (content) => {
    if(!(WH_LOG_ID && WH_LOG_TOKEN)) return;
    Actions.Webhook.Execute(WH_LOG_ID, WH_LOG_TOKEN, { content }).catch(Logger.Error);
};

client.events.on(Events.READY, () => {
    ConnectedServers.clear();
    Logger.Log('READY');
});

const EMBED_MESSAGE_COLOR = 16764928, EMBED_ERROR_COLOR = 16716876;

const GenUserInfoEmbeds = async (user) => {
    const embeds = [];

    if(!user) {
        embeds.push({
            description: 'Указан несуществующий пользователь.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    embeds.push({
        title: `${user.username}\`#${user.discriminator}\``,
        thumbnail: { url: Tools.Resource.UserAvatar(user) },
        color: EMBED_MESSAGE_COLOR,
        fields: [
            {
                name: 'Дата создания',
                value: Tools.Format.Timestamp(Math.trunc(GetUserCreationDate(user.id) / 1000), Helpers.TimestampStyles.SHORT_DATE_TIME),
            },
        ],
    });

    const xgmid = AuthUsers.get(user.id);
    if(!xgmid) {
        embeds.push({
            description: 'Нет привязки к XGM.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    const xgmres = await RequestXgmUser(xgmid).catch(Logger.Error);
    if(!xgmres) {
        embeds.push({
            description: 'Ошибка запроса к XGM.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    const { info } = xgmres;
    if(!info) {
        embeds.push({
            description: 'Привязан к несуществующему пользователю XGM.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    embeds.push({
        title: info.user.username,
        url: GenXgmUserLink(xgmid),
        thumbnail: {
            url: info.avatar.big.startsWith('https:') ?
                info.avatar.big :
                `https://xgm.guru/${info.avatar.big}`,
        },
        fields: [
            {
                name: 'Уровень',
                value: String(info.user.level),
            },
            {
                name: 'Опыт',
                value: String(info.user.level_xp),
            },
        ],
        color: EMBED_MESSAGE_COLOR,
    });

    return embeds;
};

client.events.on(Events.INTERACTION_CREATE, async (interaction) => {
    if(interaction.type != Helpers.InteractionTypes.APPLICATION_COMMAND) return;

    const
        { data } = interaction,
        user = interaction.member?.user ?? interaction.user;

    if(!(data && user)) return;
    if(!config.commands.includes(data.id)) return;

    Logger.Log(`COMMAND: ${data.name} USER: ${user.username}#${user.discriminator}`);

    const
        targetId = data.options?.find((p) => p.name == 'user')?.value ?? data.target_id,
        showPublic = Boolean(data.options?.find((p) => p.name == 'public')?.value);

    Actions.Application.CreateInteractionResponse(interaction.id, interaction.token, {
        type: Helpers.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            embeds: await GenUserInfoEmbeds((typeof targetId == 'string') ? data.resolved?.users?.[targetId] : user),
            flags: showPublic ? Helpers.MessageFlags.NO_FLAGS : Helpers.MessageFlags.EPHEMERAL,
        },
    }).catch(Logger.Error);
});

client.events.on(Events.MESSAGE_CREATE, async (message) => {
    if(message.guild_id != config.server) return;

    const channel = ConnectedServers.get(message.guild_id)?.channels.get(message.channel_id);
    if(channel?.type != Helpers.ChannelTypes.GUILD_NEWS) return;

    await Actions.Message.Crosspost(message.channel_id, message.id).catch(Logger.Error);

    const title = message.embeds?.[0]?.title;
    if(typeof title != 'string') return;

    await Actions.Thread.StartWithMessage(message.channel_id, message.id, {
        name: title.replace(/[\/\\]/g, '|'),
    }).catch(Logger.Error);
});

client.events.on(Events.GUILD_MEMBER_ADD, async (member) => {
    const { guild_id, user: { id } } = member;
    ConnectedServers.get(guild_id)?.members.set(id, member);

    if(guild_id != config.server) return;
    SendLogMsg(`<:zplus:544205514943365123> ${Tools.Mention.User(id)} присоединился к серверу.`);
    CheckUser(id, false);
});

client.events.on(Events.GUILD_MEMBER_UPDATE, (member) => {
    ConnectedServers.get(member.guild_id)?.members.set(member.user.id, member);
});

client.events.on(Events.GUILD_MEMBER_REMOVE, ({ guild_id, user: { id } }) => {
    ConnectedServers.get(guild_id)?.members.delete(id);

    if(guild_id != config.server) return;
    SendLogMsg(`<:zminus:544205486073839616> ${Tools.Mention.User(id)} покинул сервер.`);
});

client.events.on(Events.MESSAGE_REACTION_ADD, (reaction) => {
    if((reaction.guild_id != config.server) || (client.user.id == reaction.user_id)) return;
    ReactionProc(reaction, true);
});

client.events.on(Events.MESSAGE_REACTION_REMOVE, (reaction) => {
    if((reaction.guild_id != config.server) || (client.user.id == reaction.user_id)) return;
    ReactionProc(reaction, false);
});

client.events.on(Events.GUILD_CREATE, (server) => {
    AddServer(server);

    client.RequestGuildMembers({
        guild_id: server.id,
        query: '',
        limit: 0,
    });

    if(server.id != config.server) return;
    SetMarks(server.emojis);
});

client.events.on(Events.GUILD_UPDATE, ({ id, roles, channels }) => {
    const server = ConnectedServers.get(id);
    if(!server) return;

    if(roles)
        server.roles = GenMap(roles);

    if(channels)
        server.channels = GenMap(channels);
});

client.events.on(Events.GUILD_DELETE, ({ unavailable, id }) =>
    !unavailable && ConnectedServers.delete(id));

client.events.on(Events.GUILD_MEMBERS_CHUNK, (() => {
    let usersSynced = false;
    return ({ guild_id, members, chunk_index, chunk_count }) => {
        const server = ConnectedServers.get(guild_id);
        if(!server) return;

        for(const member of members)
            server.members.set(member.user.id, member);

        if(usersSynced || (server.id != config.server) || (chunk_index < chunk_count - 1)) return;
        usersSynced = true;
        RunSync();
    };
})());

const SetRoleData = ({ guild_id, role }) =>
    ConnectedServers.get(guild_id)?.roles.set(role.id, role);

client.events.on(Events.GUILD_ROLE_CREATE, SetRoleData);
client.events.on(Events.GUILD_ROLE_UPDATE, SetRoleData);

client.events.on(Events.GUILD_ROLE_DELETE, ({ guild_id, role_id }) =>
    ConnectedServers.get(guild_id)?.roles.delete(role_id));

client.events.on(Events.GUILD_BAN_ADD, ({ guild_id, user: { id } }) =>
    (guild_id == config.server) && CheckUser(id, true));

client.events.on(Events.GUILD_BAN_REMOVE, ({ guild_id, user: { id } }) =>
    (guild_id == config.server) && CheckUser(id, false));

const SetChannelData = (channel) =>
    ConnectedServers.get(channel.guild_id)?.channels.set(channel.id, channel);

client.events.on(Events.CHANNEL_CREATE, SetChannelData);
client.events.on(Events.CHANNEL_UPDATE, SetChannelData);

client.events.on(Events.CHANNEL_DELETE, ({ guild_id, id }) =>
    ConnectedServers.get(guild_id)?.channels.delete(id));

client.Connect(authorization, Helpers.Intents.SYSTEM
    | Helpers.Intents.GUILDS
    | Helpers.Intents.GUILD_MEMBERS
    | Helpers.Intents.GUILD_BANS
    | Helpers.Intents.GUILD_MESSAGES
    | Helpers.Intents.GUILD_MESSAGE_REACTIONS
);

const
    MESSAGE_MAX_CHARS = 2000,
    AUTH_SVC = process.env.AUTH_SVC,
    CLIENT_ID = process.env.CLIENT_ID,
    CLIENT_SECRET = process.env.CLIENT_SECRET,
    REDIRECT_URL = process.env.REDIRECT_URL;

const SendPM = async (recipient_id, content) => {
    const channel = await Actions.User.CreateDM({ recipient_id }).catch(Logger.Error);
    if(!channel) return;
    Actions.Message.Create(channel.id, { content }).catch(Logger.Warn);
};

const VerifyUser = async (code, xgmid) => {
    const res = await Actions.OAuth2.TokenExchange({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: Helpers.OAuth2GrantTypes.AUTHORIZATION_CODE,
        redirect_uri: REDIRECT_URL,
        scope: Helpers.OAuth2Scopes.IDENTIFY,
        code,
    }).catch(Logger.Warn);

    if(!res) {
        Logger.Warn('Verify: token request failed.');
        return { code: 400 };
    }

    const user = await Actions.User.Get('@me', { authorization: new Authorization(res.access_token, Helpers.TokenTypes.BEARER) }).catch(Logger.Error);
    if(!user) {
        Logger.Warn('Verify: user request failed.');
        return { code: 500 };
    }

    if(user.id == client.user.id)
        return { code: 418 };

    let retCode;
    const xid = AuthUsers.get(user.id);
    if(xid) {
        if(xid == xgmid) {
            SendPM(user.id, 'Аккаунт уже подтвержден.');
            retCode = 208;
        } else {
            AuthUsers.set(user.id, xgmid);
            SaveAuthUsers();
            SendLogMsg(`Перепривязка аккаунта XGM ${Tools.Mention.User(user.id)} :white_check_mark: ${GenXgmUserLink(xgmid)}\nСтарый аккаунт был <${GenXgmUserLink(xid)}>`);
            SendPM(user.id, `:white_check_mark: Аккаунт перепривязан!\n${GenXgmUserLink(xgmid)}`);
            retCode = 200;
        }
    } else {
        const prev = FindAuthUser(xgmid);
        if(prev) {
            Logger.Log(`Verify: remove ${user.id}`);
            AuthUsers.delete(prev);
            const member = ConnectedServers.get(config.server)?.members.get(prev);
            member && ClearUser(member);
        }

        Logger.Log(`Verify: ${user.id} -> ${xgmid}`);
        AuthUsers.set(user.id, xgmid);
        SaveAuthUsers();

        SendLogMsg(prev ?
            `Перепривязка аккаунта Discord ${Tools.Mention.User(user.id)} :white_check_mark: ${GenXgmUserLink(xgmid)}\nСтарый аккаунт был ${Tools.Mention.User(prev)}` :
            `Привязка аккаунта ${Tools.Mention.User(user.id)} :white_check_mark: ${GenXgmUserLink(xgmid)}`
        );
        SendPM(user.id, `:white_check_mark: Аккаунт подтвержден!\n${GenXgmUserLink(xgmid)}`);

        retCode = 200;
    }

    SyncUser(user.id, xgmid, false).catch(Logger.Error);

    return { code: retCode, content: user.id };
};

const WH_SYSLOG_ID = process.env.WH_SYSLOG_ID, WH_SYSLOG_TOKEN = process.env.WH_SYSLOG_TOKEN;

const SendSysLogMsg = async (content) => {
    for(let i = 0; i < content.length; i += MESSAGE_MAX_CHARS)
        await Actions.Webhook.Execute(WH_SYSLOG_ID, WH_SYSLOG_TOKEN, { content: content.substring(i, i + MESSAGE_MAX_CHARS) });
};

const webApiFuncs = {
    '/verify': async (request, response) => {
        const
            code = request.headers['code'],
            xgmid = Number(request.headers['userid']);

        if(!(code && (xgmid > 0)))
            return response.statusCode = 400;

        const ret = await VerifyUser(code, xgmid);
        response.statusCode = ret.code;

        if(!ret.content) return;
        response.setHeader('Content-Length', Buffer.byteLength(ret.content));
        response.write(ret.content);
    },

    '/delete': async (request, response) => {
        const xgmid = Number(request.headers['userid']);
        if(!(xgmid > 0)) return response.statusCode = 400;

        const id = FindAuthUser(xgmid);
        if(!id) return response.statusCode = 200;

        if(id == client.user.id)
            return response.statusCode = 418;

        Logger.Log(`Verify: delete! ${id}`);

        AuthUsers.delete(id);
        SaveAuthUsers();

        const member = ConnectedServers.get(config.server)?.members.get(id);
        member && ClearUser(member);

        const
            data = await ReadIncomingData(request),
            reason = data ? `**Причина:** ${data}` : '';

        SendLogMsg(`Отвязка аккаунта ${Tools.Mention.User(id)} :no_entry: ${GenXgmUserLink(xgmid)}\n${reason}`);
        SendPM(id, `:no_entry: Аккаунт деавторизован.\n${reason}`);

        response.statusCode = 200;
    },

    '/update-global-status': async (request, response) => {
        const xgmid = Number(request.headers['userid']);
        if(!(xgmid > 0)) return response.statusCode = 400;

        Logger.Log(`S: ${xgmid} - '${request.headers['status']}'`);

        const id = FindAuthUser(xgmid);
        if(!id) return response.statusCode = 200;

        if(id == client.user.id)
            return response.statusCode = 418;

        setImmediate(async () => SyncUser(
            id,
            xgmid,
            await Actions.Ban.Get(config.server, id).
                then(() => true).
                catch((e) => ((e.code == 404) || Logger.Error(e), false)),
        ).catch(Logger.Error));

        response.statusCode = 200;
    },

    '/pm': async (request, response) => {
        const xgmid = Number(request.headers['userid']);
        if(!(xgmid > 0)) return response.statusCode = 400;

        const id = FindAuthUser(xgmid);
        if(!id) return response.statusCode = 404;

        if(id == client.user.id)
            return response.statusCode = 418;

        const data = await ReadIncomingData(request);
        if(!data) return response.statusCode = 400;

        SendPM(id, String(data).substring(0, MESSAGE_MAX_CHARS));

        response.statusCode = 200;
    },

    '/send': async (request, response) => {
        const channelid = request.headers['channelid'];
        if(!channelid) return response.statusCode = 400;

        const data = await ReadIncomingData(request);
        if(!data) return response.statusCode = 400;

        try {
            await Actions.Message.Create(channelid, { content: String(data).substring(0, MESSAGE_MAX_CHARS) });
        } catch(e) {
            Logger.Error(e);
            response.statusCode = e.code ?? 500;
            return;
        }

        response.statusCode = 200;
    },

    '/sys': async (request, response) => {
        const data = await ReadIncomingData(request);
        if(!data) return response.statusCode = 400;

        SendSysLogMsg(String(data)).catch(Logger.Error);
        response.statusCode = 200;
    },
};

const MAX_PAYLOAD = 8 * 1024;

const HandleRequest = async (request, response) => {
    const { method, headers, url } = request;
    Logger.Log(`${method} '${url}'`);

    if(method != 'POST')
        return response.statusCode = 405;

    if(headers['authorization'] != AUTH_SVC)
        return response.statusCode = 401;

    if(!webApiFuncs.hasOwnProperty(url))
        return response.statusCode = 404;

    if(Number(headers['content-length']) > MAX_PAYLOAD)
        return response.statusCode = 413;

    await webApiFuncs[url](request, response);
};

import http from 'http';

AUTH_SVC && CLIENT_ID && CLIENT_SECRET && REDIRECT_URL && http.createServer(async (request, response) => {
    await HandleRequest(request, response).catch((e) => {
        Logger.Error(e);
        response.statusCode = 500;
    });
    response.end();
    Logger.Log(`Response end. Code: ${response.statusCode}`);
}).listen(80);
