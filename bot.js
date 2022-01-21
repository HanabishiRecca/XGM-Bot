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

import Database from 'nedb-promise';
import { Client, ClientEvents, Authorization, Events, Actions, Helpers, Tools } from 'discord-slim';
import { HttpsGet, ReadIncomingData } from './misc.js';
import config from './config.js';

const usersDb = Database({ filename: `${process.env.STORAGE}/users.db`, autoload: true });

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
    SendMessage = (channel_id, content, embed) => Actions.Message.Create(channel_id, { content, embed }),
    HasRole = (member, role_id) => member.roles.indexOf(role_id) > -1,
    InProject = (status) => status && ((status == 'leader') || (status == 'moderator') || (status == 'active')),
    XgmUserLink = (xgmid) => `https://xgm.guru/user/${xgmid}`;

const SendPM = async (user_id, content) => {
    const channel = await Actions.User.CreateDM({ recipient_id: user_id });
    return SendMessage(channel.id, content).catch(Logger.Warn);
};

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
    (add ? Actions.Member.AddRole : Actions.Member.RemoveRole)(reaction.guild_id, reaction.user_id, mark.role);
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
            const message = await Actions.Message.Get(msg.channel, msg.id);
            if(!message) continue;
            for(const mark of msg.marks) {
                if(message.reactions.find((elem) => elem.emoji.id == mark.emoji)) continue;
                await Actions.Reaction.Add(message.channel_id, message.id, Tools.Format.Reaction(emojiMap.get(mark.emoji)));
            }
        }
    };
})();

const ConnectedServers = new Map();

const RoleSwitch = async (member, role, enable) => {
    if(!member || !role) return;
    if(enable) {
        if(!HasRole(member, role))
            await Actions.Member.AddRole(config.server, member.user.id, role);
    } else {
        if(HasRole(member, role))
            await Actions.Member.RemoveRole(config.server, member.user.id, role);
    }
};

const RequestXgmUser = async (xgmid) => {
    try {
        return JSON.parse(await HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`));
    } catch(e) {
        Logger.Warn(e);
    }
};

const SyncUser = async (userid, xgmid, banned) => {
    if(userid == client.user.id) return;

    const response = await RequestXgmUser(xgmid);
    if(!response) return;

    const
        status = response.state?.access?.staff_status,
        member = ConnectedServers.get(config.server)?.members?.get(userid);

    if(status == 'suspended') {
        if(member || !banned)
            await Actions.Ban.Add(config.server, userid, { reason: 'Бан на сайте' });
        return;
    }

    if(!member) {
        if(banned)
            await Actions.Ban.Remove(config.server, userid);
        return;
    }

    await RoleSwitch(member, config.role.readonly, status == 'readonly');
    await RoleSwitch(member, config.role.user, true);
    await RoleSwitch(member, config.role.staff, InProject(status));
    await RoleSwitch(member, config.role.team, InProject(response.state?.projects?.['833']?.status));
    await RoleSwitch(member, config.role.twilight, response.info?.user?.seeTwilight);
};

const SyncUsers = async () => {
    const members = ConnectedServers.get(config.server)?.members;
    if(!members) return;

    const
        bans = await Actions.Guild.GetBans(config.server),
        banned = new Set();

    for(const banInfo of bans)
        banned.add(banInfo.user.id);

    const users = await usersDb.find({});
    try {
        for(const userInfo of users)
            await SyncUser(userInfo._id, userInfo.xgmid, banned.has(userInfo._id));
    } catch(e) {
        Logger.Error(e);
    }

    const xgms = new Set();
    for(const userInfo of users)
        xgms.add(userInfo._id);

    try {
        for(const member of members.values())
            if(member && !xgms.has(member.user.id)) {
                await RoleSwitch(member, config.role.readonly, false);
                await RoleSwitch(member, config.role.user, false);
                await RoleSwitch(member, config.role.staff, false);
                await RoleSwitch(member, config.role.team, false);
                await RoleSwitch(member, config.role.twilight, false);
            }
    } catch(e) {
        Logger.Error(e);
    }
};

const RunSync = async () => {
    await SyncUsers().catch(Logger.Error);
    global.gc?.();
};

setInterval(RunSync, 3600000);

const CheckBan = async (data, flag) => {
    if(!((data.guild_id == config.server) && data.user)) return;

    const userInfo = await usersDb.findOne({ _id: data.user.id });
    if(!userInfo) return;

    SyncUser(data.user.id, userInfo._id, flag);
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

client.events.on(Events.READY, (data) => {
    ConnectedServers.clear();
    Logger.Log('READY');
});

client.events.on(Events.INTERACTION_CREATE, async (interaction) => {
    if(interaction.type != Helpers.InteractionTypes.APPLICATION_COMMAND) return;

    const data = interaction.data, user = interaction.user ?? interaction.member?.user;
    if(!(data && user)) return;

    Logger.Log(`COMMAND: ${data.name} USER: ${user.username}#${user.discriminator}`);

    let _id, showPublic;
    if(data.name == 'who') {
        const options = data.options;
        if(!options) return;
        _id = options[0]?.value;
        showPublic = options[1]?.value;
    } else if(data.name == 'who_user') {
        _id = data.target_id;
    }

    if(!_id) return;

    const embeds = [];

    try {
        const target = await Actions.User.Get(String(_id));
        embeds.push({
            title: `${target.username}\`#${target.discriminator}\``,
            thumbnail: { url: Tools.Resource.UserAvatar(target) },
            color: 16764928,
        });
    } catch(e) {
        embeds.push({
            description: (e.code == 404) ?
                'Указан несуществующий пользователь.' :
                'Ошибка запроса к Discord.',
            color: 16716876,
        });
    }

    const xgmid = (await usersDb.findOne({ _id }))?.xgmid;
    if(xgmid) {
        const xgmres = await RequestXgmUser(xgmid);
        if(xgmres) {
            const info = xgmres.info;
            if(info) {
                embeds.push({
                    title: info.user.username,
                    url: XgmUserLink(xgmid),
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
                    color: 16764928,
                });
            } else {
                embeds.push({
                    description: 'Привязан к несуществующему пользователю XGM.',
                    color: 16716876,
                });
            }
        } else {
            embeds.push({
                description: 'Ошибка запроса к XGM.',
                color: 16716876,
            });
        }
    } else {
        embeds.push({
            description: 'Нет привязки к XGM.',
            color: 16716876,
        });
    }

    Actions.Application.CreateInteractionResponse(interaction.id, interaction.token, {
        type: Helpers.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            embeds,
            flags: showPublic ? 0 : Helpers.InteractionCallbackDataFlags.EPHEMERAL,
        },
    }).catch(Logger.Error);
});

client.events.on(Events.MESSAGE_CREATE, (message) => {
    if(message.guild_id != config.server) return;

    const channel = ConnectedServers.get(message.guild_id)?.channels.get(message.channel_id);
    if(channel?.type != Helpers.ChannelTypes.GUILD_NEWS) return;

    Actions.Message.Crosspost(message.channel_id, message.id).catch(Logger.Warn);

    const title = message.embeds?.[0]?.title;
    if(typeof title != 'string') return;

    Actions.Thread.StartWithMessage(message.channel_id, message.id, {
        name: title.replace(/[\/\\]/g, '|'),
    }).catch(Logger.Warn);
});

client.events.on(Events.GUILD_MEMBER_ADD, async (member) => {
    ConnectedServers.get(member.guild_id)?.members.set(member.user.id, member);

    if(member.guild_id != config.server) return;

    SendLogMsg(`<:zplus:544205514943365123> ${Tools.Mention.User(member.user.id)} присоединился к серверу.`);

    const userInfo = await usersDb.findOne({ _id: member.user.id });
    userInfo && SyncUser(userInfo._id, userInfo.xgmid, false);
});

client.events.on(Events.GUILD_MEMBER_UPDATE, (member) => {
    ConnectedServers.get(member.guild_id)?.members.set(member.user.id, member);
});

client.events.on(Events.GUILD_MEMBER_REMOVE, (member) => {
    ConnectedServers.get(member.guild_id)?.members.delete(member.user.id);

    if(member.guild_id != config.server) return;

    SendLogMsg(`<:zminus:544205486073839616> ${Tools.Mention.User(member.user.id)} покинул сервер.`);
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

client.events.on(Events.GUILD_DELETE, (deleted) =>
    !deleted.unavailable && ConnectedServers.delete(deleted.id));

client.events.on(Events.GUILD_MEMBERS_CHUNK, (() => {
    let usersSynced = false;
    return (chunk) => {
        const server = ConnectedServers.get(chunk.guild_id);
        if(!server) return;

        for(const member of chunk.members)
            server.members.set(member.user.id, member);

        if(usersSynced || (server.id != config.server) || (chunk.chunk_index < chunk.chunk_count - 1)) return;

        usersSynced = true;
        RunSync();
    };
})());

const SetRoleData = (data) =>
    ConnectedServers.get(data.guild_id)?.roles.set(data.role.id, data.role);

client.events.on(Events.GUILD_ROLE_CREATE, SetRoleData);
client.events.on(Events.GUILD_ROLE_UPDATE, SetRoleData);

client.events.on(Events.GUILD_ROLE_DELETE, (data) =>
    ConnectedServers.get(data.guild_id)?.roles.delete(data.role_id));

client.events.on(Events.GUILD_BAN_ADD, (data) => CheckBan(data, true));

client.events.on(Events.GUILD_BAN_REMOVE, (data) => CheckBan(data, false));

const SetChannelData = (channel) =>
    ConnectedServers.get(channel.guild_id)?.channels.set(channel.id, channel);

client.events.on(Events.CHANNEL_CREATE, SetChannelData);
client.events.on(Events.CHANNEL_UPDATE, SetChannelData);

client.events.on(Events.CHANNEL_DELETE, (channel) =>
    ConnectedServers.get(channel.guild_id)?.channels.delete(channel.id));

client.Connect(authorization, 0
    | Helpers.Intents.GUILDS
    | Helpers.Intents.GUILD_MEMBERS
    | Helpers.Intents.GUILD_BANS
    | Helpers.Intents.GUILD_MESSAGES
    | Helpers.Intents.GUILD_MESSAGE_REACTIONS
);

const
    AUTH_SVC = process.env.AUTH_SVC,
    CLIENT_ID = process.env.CLIENT_ID,
    CLIENT_SECRET = process.env.CLIENT_SECRET,
    REDIRECT_URL = process.env.REDIRECT_URL;

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

    const user = await Actions.User.Get('@me', { authorization: new Authorization(res.access_token, Helpers.TokenTypes.BEARER) }).catch(Logger.Warn);
    if(!user) {
        Logger.Warn('Verify: user request failed.');
        return { code: 500 };
    }

    if(user.id == client.user.id)
        return { code: 418 };

    let retCode;
    const userInfo = await usersDb.findOne({ _id: user.id });
    if(userInfo) {
        if(userInfo.xgmid == xgmid) {
            SendPM(user.id, 'Аккаунт уже подтвержден.');
            retCode = 208;
        } else {
            await usersDb.update({ _id: user.id }, { xgmid });
            usersDb.nedb.persistence.compactDatafile();
            SendLogMsg(`Перепривязка аккаунта XGM ${Tools.Mention.User(user.id)} :white_check_mark: ${XgmUserLink(xgmid)}\nСтарый аккаунт был <${XgmUserLink(userInfo.xgmid)}>`);
            SendPM(user.id, `:white_check_mark: Аккаунт перепривязан!\n${XgmUserLink(xgmid)}`);
            retCode = 200;
        }
    } else {
        const clone = await usersDb.findOne({ xgmid });
        if(clone) {
            Logger.Log(`Verify: remove ${user.id}`);
            await usersDb.remove({ xgmid });
            const member = ConnectedServers.get(config.server).members.get(clone._id);
            if(member) {
                Actions.Member.RemoveRole(config.server, member.user.id, config.role.user);
                Actions.Member.RemoveRole(config.server, member.user.id, config.role.twilight);
            }
        }

        Logger.Log(`Verify: ${user.id} -> ${xgmid}`);
        await usersDb.insert({ _id: user.id, xgmid });
        usersDb.nedb.persistence.compactDatafile();

        SendLogMsg(clone ?
            `Перепривязка аккаунта Discord ${Tools.Mention.User(user.id)} :white_check_mark: ${XgmUserLink(xgmid)}\nСтарый аккаунт был ${Tools.Mention.User(clone._id)}` :
            `Привязка аккаунта ${Tools.Mention.User(user.id)} :white_check_mark: ${XgmUserLink(xgmid)}`
        );
        SendPM(user.id, `:white_check_mark: Аккаунт подтвержден!\n${XgmUserLink(xgmid)}`);

        retCode = 200;
    }

    SyncUser(user.id, xgmid, false);

    return { code: retCode, content: user.id };
};

const WH_SYSLOG_ID = process.env.WH_SYSLOG_ID, WH_SYSLOG_TOKEN = process.env.WH_SYSLOG_TOKEN;

const SendSysLogMsg = async (content) => {
    if(!(WH_SYSLOG_ID && WH_SYSLOG_TOKEN)) return;
    if(!content) return;

    for(let i = 0; i < content.length; i += 2000)
        await Actions.Webhook.Execute(WH_SYSLOG_ID, WH_SYSLOG_TOKEN, { content: content.substr(i, 2000) }).catch(Logger.Error);
};

const webApiFuncs = {
    '/verify': async (request, response) => {
        const
            code = request.headers.code,
            xgmid = Number(request.headers.userid);

        if(!(code && (xgmid > 0)))
            return response.statusCode = 400;

        const ret = await VerifyUser(code, xgmid);
        response.statusCode = ret.code;

        if(!ret.content) return;
        response.setHeader('Content-Length', Buffer.byteLength(ret.content));
        response.write(ret.content);
    },

    '/delete': async (request, response) => {
        const xgmid = Number(request.headers.userid);
        if(!(xgmid > 0))
            return response.statusCode = 400;

        const userInfo = await usersDb.findOne({ xgmid });
        if(!userInfo)
            return response.statusCode = 406;

        if(userInfo._id == client.user.id)
            return response.statusCode = 418;

        const data = await ReadIncomingData(request);

        Logger.Log(`Verify: delete! ${userInfo._id}`);
        await usersDb.remove({ xgmid });
        usersDb.nedb.persistence.compactDatafile();
        SendLogMsg(`Отвязка аккаунта ${Tools.Mention.User(userInfo._id)} :no_entry: ${XgmUserLink(xgmid)}` + (data ? `\n**Причина:** ${data}` : ''));

        if(ConnectedServers.get(config.server).members.has(userInfo._id))
            Actions.Member.RemoveRole(config.server, userInfo._id, config.role.user);

        SendPM(userInfo._id, ':no_entry: Аккаунт деавторизован, так как был удален.');

        response.statusCode = 200;
    },

    '/update-global-status': async (request, response) => {
        const xgmid = Number(request.headers.userid);
        if(!(xgmid > 0))
            return response.statusCode = 400;

        Logger.Log(`S: ${xgmid} - '${request.headers.status}'`);

        const userInfo = await usersDb.findOne({ xgmid });
        if(!userInfo)
            return response.statusCode = 200;

        if(userInfo._id == client.user.id)
            return response.statusCode = 418;

        (async () => {
            SyncUser(userInfo._id, xgmid, await Actions.Ban.Get(config.server, userInfo._id).catch(Logger.Warn));
        })();

        response.statusCode = 200;
    },

    '/pm': async (request, response) => {
        const xgmid = Number(request.headers.userid);
        if(!(xgmid > 0))
            return response.statusCode = 400;

        const userInfo = await usersDb.findOne({ xgmid });
        if(!userInfo)
            return response.statusCode = 406;

        if(userInfo._id == client.user.id)
            return response.statusCode = 418;

        const len = Number(request.headers['Content-Length']);
        if(len > 4000)
            return response.statusCode = 413;

        const data = await ReadIncomingData(request);
        if(!data)
            return response.statusCode = 400;

        const text = String(data);
        SendPM(userInfo._id, (text.length > 2000) ? text.substring(0, 1999) : text);

        response.statusCode = 200;
    },

    '/send': async (request, response) => {
        const channelid = request.headers.channelid;
        if(!channelid)
            return response.statusCode = 400;

        const len = Number(request.headers['Content-Length']);
        if(len > 4000)
            return response.statusCode = 413;

        const data = await ReadIncomingData(request);
        if(!data)
            return response.statusCode = 400;

        const text = String(data);
        try {
            await SendMessage(channelid, (text.length > 2000) ? text.substring(0, 1999) : text);
            response.statusCode = 200;
        } catch(e) {
            Logger.Warn(e);
            response.statusCode = 403;
        }
    },

    '/sys': async (request, response) => {
        const len = Number(request.headers['Content-Length']);
        if(len > 4000)
            return response.statusCode = 413;

        const data = await ReadIncomingData(request);
        if(!data)
            return response.statusCode = 400;

        SendSysLogMsg(String(data));

        response.statusCode = 200;
    },
};

const HandleRequest = async (request, response) => {
    if(request.method != 'POST')
        return response.statusCode = 405;

    if(request.headers.authorization != AUTH_SVC)
        return response.statusCode = 401;

    if(!webApiFuncs.hasOwnProperty(request.url))
        return response.statusCode = 404;

    Logger.Log(`POST '${request.url}'`);
    await webApiFuncs[request.url](request, response);
};

import http from 'http';

AUTH_SVC && CLIENT_ID && CLIENT_SECRET && REDIRECT_URL && http.createServer(async (request, response) => {
    try {
        await HandleRequest(request, response);
    } catch(e) {
        Logger.Error(e);
        response.statusCode = 500;
    }
    response.end();
}).listen(80);
