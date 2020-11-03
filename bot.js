'use strict';

require('./log.js');

const Shutdown = err => {
    console.error(err);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

!process.env.TOKEN && Shutdown('Token required.');

const storagePath = process.env.STORAGE;
!storagePath && Shutdown('Storage path required.');

global.gc && setInterval(global.gc, 3600000);

const
    Database = require('nedb-promise'),
    MariaDB = require('mariadb'),
    Discord = require('discord-slim'),
    XmlParser = require('fast-xml-parser'),
    Misc = require('./misc.js'),
    config = require('./config.json');

const
    appDb = new Database({ filename: `${storagePath}/app.db`, autoload: true }),
    usersDb = new Database({ filename: `${storagePath}/users.db`, autoload: true });

const mdbConnectionOptions = (process.env.MDB_HOST && process.env.MDB_DATABASE && process.env.MDB_USER && process.env.MDB_PASSWORD) ? {
    host: process.env.MDB_HOST,
    database: process.env.MDB_DATABASE,
    user: process.env.MDB_USER,
    password: process.env.MDB_PASSWORD,
    bigNumberStrings: true,
} : undefined;

const client = new Discord.Client();

client.on('connect', () => console.log('Connection established.'));
client.on('disconnect', code => console.error(`Disconnect. (${code})`));
client.on('warn', console.warn);
client.on('error', console.error);
client.on('fatal', Shutdown);

const
    Routes = Discord.Routes,
    ConnectedServers = new Map(),
    SafePromise = promise => new Promise(resolve => promise.then(result => resolve(result)).catch(error => { console.warn(error); resolve(null); }));

const
    AddReaction = (channel, message, emoji) => client.Request('put', Routes.Reaction(channel, message, emoji) + '/@me'),
    AddRole = (server, user, role) => client.Request('put', Routes.Role(server, user, role)),
    BanUser = (server, user, reason) => client.Request('put', `${Routes.Server(server)}/bans/${user.id || user}?reason=${encodeURI(reason)}`),
    GetBans = server => client.Request('get', Routes.Server(server) + '/bans'),
    GetMessage = (channel, message) => client.Request('get', Routes.Message(channel, message)),
    GetUserChannel = user => client.Request('post', Routes.User('@me') + '/channels', { recipient_id: user.id || user }),
    RemoveRole = (server, user, role) => client.Request('delete', Routes.Role(server, user, role)),
    SendMessage = (channel, content, embed) => client.Request('post', Routes.Channel(channel) + '/messages', { content, embed }),
    UnbanUser = (server, user) => client.Request('delete', `${Routes.Server(server)}/bans/${user.id || user}`);

const
    ChannelMention = channel => `<#${channel.id || channel}>`,
    HasRole = (member, role) => member.roles.indexOf(role.id || role) > -1,
    UserMention = user => `<@${user.id || user}>`,
    XgmUserLink = xgmid => `https://xgm.guru/user/${xgmid}`;

const SendPM = async (user, msg) => await SafePromise(SendMessage(await GetUserChannel(user), msg));

const botCommands = {
    help: async message => {
        SendMessage(message.channel_id, `**Справка**

\`who @user\` - получить информацию о привязке указанного пользователя.
\`help\` - показать данное сообщение.

*Команды можно отправлять боту в ЛС.*
*Для упоминания любого пользователя в дискорде можно использовать его ID в виде \`<@ID>\`.*`);
    },

    who: async message => {
        if(!(message.mentions && message.mentions.length))
            return;

        const userData = await usersDb.findOne({ _id: message.mentions[0] });
        message.reply(userData ? XgmUserLink(userData.xgmid) : 'Пользователь не сопоставлен.');
    },
};

botCommands.whois = botCommands.who;

const MarkMessages = (() => {
    const
        list = require('./marks.js').list,
        msgs = new Map();

    for(let i = 0; i < list.length; i++) {
        const mark = list[i];
        if(msgs.has(mark.message))
            msgs.get(mark.message).marks.push(mark);
        else
            msgs.set(mark.message, { id: mark.message, channel: mark.channel, marks: [mark] });
    }

    return msgs;
})();

const ReactionProc = async (reaction, add) => {
    const msg = MarkMessages.get(reaction.message_id);
    if(!msg)
        return;

    const mark = msg.marks.find(elem => elem.emoji == reaction.emoji.id);
    mark && (add ? AddRole : RemoveRole)(reaction.guild_id, reaction.user_id, mark.role);
};

const SetMarks = async serverEmojis => {
    if(MarkMessages.synced)
        return;

    MarkMessages.synced = true;

    const emojiMap = new Map();
    for(let i = 0; i < serverEmojis.length; i++) {
        const emoji = serverEmojis[i];
        emojiMap.set(emoji.id, emoji);
    }

    for(const msg of MarkMessages.values()) {
        const message = await GetMessage(msg.channel, msg.id);
        if(!message)
            continue;

        for(let i = 0; i < msg.marks.length; i++) {
            const mark = msg.marks[i];
            if(message.reactions.find(elem => elem.emoji.id == mark.emoji))
                continue;

            const emoji = emojiMap.get(mark.emoji);
            await AddReaction(message.channel_id, message.id, `${emoji.name}:${emoji.id}`);
        }
    }
};

const appOptions = {
    lastNewsTime: { _id: 'lastNewsTime' },
};

const CheckNews = async () => {
    const data = await Misc.HttpsGet('https://xgm.guru/rss');
    if(!(data && data.length))
        return;

    const feed = XmlParser.parse(data.toString(), { ignoreAttributes: false, attributeNamePrefix: '' });
    if(!(feed.rss && feed.rss.channel && feed.rss.channel.item))
        return;

    const
        option = await appDb.findOne(appOptions.lastNewsTime),
        lastTime = option ? option.value : Date.now(),
        items = feed.rss.channel.item;

    let maxTime = 0;
    for(let i = items.length - 1; i >= 0; i--) {
        const
            item = items[i],
            dt = new Date(item.pubDate),
            time = dt.getTime();

        if(time > maxTime)
            maxTime = time;

        if(time > lastTime) {
            const embed = {
                title: Misc.DecodeHtmlEntity(item.title),
                description: Misc.DecodeHtmlEntity(item.description.replace(/<\/?[^<>]*>/gm, '')),
                url: item.link,
                footer: { text: item.author },
                timestamp: dt,
                color: 16764928,
                image: item.enclosure ? { url: item.enclosure.url } : null,
            };
            SendMessage(config.channel.news, '', embed);

            embed.timestamp = undefined;
            SendMessage(config.channel.newsCode, `\`\`\`b/post\n${JSON.stringify({ content: 'https://discord.gg/TuSHPU6', embed }, null, 4)}\`\`\``);
        }
    }

    if(lastTime != maxTime)
        await appDb.update(appOptions.lastNewsTime, { $set: { value: maxTime } }, { upsert: true });
};

setInterval(CheckNews, 600000);

const SyncUser = async (userid, xgmid, banned) => {
    if(userid == client.user.id)
        return;

    const response = JSON.parse(await SafePromise(Misc.HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`)));
    if(!response)
        return;

    const
        status = response.state.access.staff_status,
        member = ConnectedServers.get(config.server).members.get(userid);

    if(status == 'readonly') {
        if(member && !HasRole(member, config.role.readonly))
            await AddRole(config.server, member.user, config.role.readonly);
    } else if(status == 'suspended') {
        if(!banned.has(userid))
            await BanUser(config.server, userid, 'Бан на сайте');
        return;
    } else {
        if(member) {
            if(HasRole(member, config.role.readonly))
                await RemoveRole(config.server, userid, config.role.readonly);
        } else if(banned.has(userid)) {
            await UnbanUser(config.server, userid);
        }
    }

    if(!member)
        return;

    if(!HasRole(member, config.role.user))
        await AddRole(config.server, member.user, config.role.user);

    if(response.info.user.seeTwilight) {
        if(!HasRole(member, config.role.twilight))
            await AddRole(config.server, member.user, config.role.twilight);
    } else {
        if(HasRole(member, config.role.twilight))
            await RemoveRole(config.server, member.user, config.role.twilight);
    }
};

const SyncUsers = async () => {
    const
        bans = await GetBans(config.server),
        banned = new Set();

    for(const banInfo of bans)
        banned.add(banInfo.user.id);

    const
        users = await usersDb.find({}),
        xgms = new Set();

    try {
        for(const userInfo of users) {
            xgms.add(userInfo._id);
            await SyncUser(userInfo._id, userInfo.xgmid, banned);
        }
    } catch(e) {
        console.error(e);
    }

    try {
        for(const member of ConnectedServers.get(config.server).members.values())
            if(member && !xgms.has(member.user.id) && HasRole(member, config.role.user))
                await RemoveRole(config.server, member.user, config.role.user);
    } catch(e) {
        console.error(e);
    }
};

setInterval(SyncUsers, 3600000);

const SaveMessage = async message => {
    if(!mdbConnectionOptions)
        return;

    if(!(message.content && message.guild_id))
        return;

    const connection = await MariaDB.createConnection(mdbConnectionOptions);
    try {
        await connection.query({ namedPlaceholders: true, sql: 'insert into messages (id,user,text) values (:id,:user,:text) on duplicate key update text=:text;' }, { id: message.id, user: message.author.id, text: message.content });
    } catch(err) {
        console.error(err);
    } finally {
        connection.end();
    }
};

const LoadMessage = async message => {
    if(!mdbConnectionOptions)
        return;

    let results;
    const connection = await MariaDB.createConnection(mdbConnectionOptions);
    try {
        results = await connection.query('select user,dt,text from messages where (id=?) limit 1;', [message.id]);
    } catch(err) {
        console.error(err);
    } finally {
        connection.end();
    }

    if(results && results.length)
        return results[0];
};

const GenRolesMap = roles => {
    const map = new Map();
    for(let i = 0; i < roles.length; i++) {
        const role = roles[i];
        map.set(role.id, role);
    }
    return map;
};

const AddServer = server => {
    ConnectedServers.set(server.id, {
        id: server.id,
        roles: GenRolesMap(server.roles),
        members: new Map(),
    });
};

const UpdateServer = (server, update) => {
    server.roles = GenRolesMap(update.roles);
};

const FakeSetAns = { has: () => false };

const events = {
    READY: async data => {
        client.user = data.user;
        client.WsSend({ op: 3, d: { status: { web: 'online' }, game: { name: '/help', type: 3 }, afk: false, since: 0 } });

        ConnectedServers.clear();

        const servers = data.guilds;
        for(let i = 0; i < servers.length; i++) {
            const server = servers[i];
            ConnectedServers.set(server.id, server);
        }

        console.log('READY');
    },

    MESSAGE_CREATE: async message => {
        if(message.guild_id && (message.guild_id != config.server))
            return;

        if(!message.content)
            return;

        if(message.author.id == client.user.id)
            return;

        message.guild_id && SaveMessage(message);

        if(!message.content.startsWith(config.prefix))
            return;

        const
            si = message.content.search(/(\s|\n|$)/),
            command = message.content.substring(config.prefix.length, (si > 0) ? si : undefined).toLowerCase();

        if(!(command && botCommands.hasOwnProperty(command)))
            return;

        message.content = message.content.substring((si > 0) ? (si + 1) : '');
        message.mentions = Misc.GetMentions(message.content);
        message.reply = content => SendMessage(message.channel_id, message.guild_id ? `${UserMention(message.author)}\n${content}` : content);

        message.server = message.guild_id ? ConnectedServers.get(message.guild_id) : ConnectedServers.get(config.server);

        if(!message.member)
            message.member = message.server.members.get(message.author.id);

        console.log(`COMMAND (${command}) ARG (${message.content}) USER (${message.author.username}#${message.author.discriminator}) ${message.guild_id ? 'SERVER' : 'PM'}`);
        botCommands[command](message);
    },

    MESSAGE_UPDATE: async message => {
        if(message.guild_id != config.server)
            return;

        if(!message.author)
            return;

        if(message.author.id == client.user.id)
            return;

        const result = await LoadMessage(message);

        SaveMessage(message);

        if(!result)
            return;

        SendMessage(config.channel.deleted, '', {
            title: 'Сообщение изменено',
            fields: [
                {
                    name: 'Автор',
                    value: UserMention(result.user),
                    inline: true,
                },
                {
                    name: 'Канал',
                    value: ChannelMention(message.channel_id),
                    inline: true,
                },
                {
                    name: 'Содержимое',
                    value: (result.text.length > 1024) ? result.text.substr(0, 1024) : result.text,
                },
                {
                    name: 'Переход',
                    value: `${Discord.Host}/channels/${message.guild_id}/${message.channel_id}/${message.id}`,
                },
            ],
            timestamp: new Date(result.dt),
        });
    },

    MESSAGE_DELETE: async message => {
        if(message.guild_id != config.server)
            return;

        const result = await LoadMessage(message);
        if(!result)
            return;

        SendMessage(config.channel.deleted, '', {
            title: 'Сообщение удалено',
            fields: [
                {
                    name: 'Автор',
                    value: UserMention(result.user),
                    inline: true,
                },
                {
                    name: 'Канал',
                    value: ChannelMention(message.channel_id),
                    inline: true,
                },
                {
                    name: 'Содержимое',
                    value: (result.text.length > 1024) ? result.text.substr(0, 1024) : result.text,
                },
            ],
            timestamp: new Date(result.dt),
        });
    },

    GUILD_MEMBER_ADD: async member => {
        const server = ConnectedServers.get(member.guild_id);
        server && server.members.set(member.user.id, member);

        if(member.guild_id != config.server)
            return;

        SendMessage(config.channel.log, `<:zplus:544205514943365123> ${UserMention(member.user)} присоединился к серверу.`);

        const userInfo = await usersDb.findOne({ _id: member.user.id });
        userInfo && SyncUser(userInfo._id, userInfo.xgmid, FakeSetAns);
    },

    GUILD_MEMBER_UPDATE: async member => {
        const server = ConnectedServers.get(member.guild_id);
        server && server.members.set(member.user.id, member);
    },

    GUILD_MEMBER_REMOVE: async member => {
        const server = ConnectedServers.get(member.guild_id);
        server && server.members.delete(member.user.id);

        if(member.guild_id == config.server)
            SendMessage(config.channel.log, `<:zminus:544205486073839616> ${UserMention(member.user)} покинул сервер.`);
    },

    MESSAGE_REACTION_ADD: async reaction => {
        if(reaction.guild_id != config.server)
            return;

        if(client.user.id != reaction.user_id)
            ReactionProc(reaction, true);
    },

    MESSAGE_REACTION_REMOVE: async reaction => {
        if(reaction.guild_id != config.server)
            return;

        if(client.user.id != reaction.user_id)
            ReactionProc(reaction, false);
    },

    GUILD_CREATE: async server => {
        AddServer(server);
        client.WsSend({ op: 8, d: { guild_id: server.id, query: '', limit: 0 } });

        if(server.id != config.server)
            return;

        SetMarks(server.emojis);
        CheckNews();
    },

    GUILD_UPDATE: async update => {
        const server = ConnectedServers.get(update.id);
        server && UpdateServer(server, update);
    },

    GUILD_DELETE: async deleted => {
        !deleted.unavailable && ConnectedServers.delete(deleted.id);
    },

    GUILD_MEMBERS_CHUNK: async chunk => {
        const server = ConnectedServers.get(chunk.guild_id);
        if(!server)
            return;

        const
            map = server.members,
            members = chunk.members;

        for(let i = 0; i < members.length; i++) {
            const member = members[i];
            map.set(member.user.id, member);
        }

        if((server.id == config.server) && (chunk.chunk_index >= chunk.chunk_count - 1))
            SyncUsers();
    },

    GUILD_ROLE_CREATE: async data => {
        const server = ConnectedServers.get(data.guild_id);
        server && server.roles.set(data.role.id, data.role);
    },

    GUILD_ROLE_UPDATE: async data => {
        const server = ConnectedServers.get(data.guild_id);
        server && server.roles.set(data.role.id, data.role);
    },

    GUILD_ROLE_DELETE: async data => {
        const server = ConnectedServers.get(data.guild_id);
        server && server.roles.delete(data.role_id);
    },
};

client.on('packet', async packet => {
    const event = events[packet.t];
    event && event(packet.d);
});

client.Auth(process.env.TOKEN);
client.Connect(Discord.Intents.GUILDS | Discord.Intents.GUILD_MEMBERS | Discord.Intents.GUILD_MESSAGES | Discord.Intents.GUILD_MESSAGE_REACTIONS | Discord.Intents.DIRECT_MESSAGES);

if(!(process.env.AUTH_SVC && process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.REDIRECT_URL))
    return;

const
    AUTH_SVC = process.env.AUTH_SVC,
    CLIENT_ID = encodeURIComponent(process.env.CLIENT_ID),
    CLIENT_SECRET = encodeURIComponent(process.env.CLIENT_SECRET),
    REDIRECT_URL = encodeURIComponent(process.env.REDIRECT_URL);

const VerifyUser = async (code, xgmid) => {
    const res = await SafePromise(client.Request('post', '/oauth2/token', `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${REDIRECT_URL}&scope=identify`));
    if(!(res && res.access_token)) {
        console.warn('Verify: token request failed.');
        return 400;
    }

    const user = await SafePromise(client.Request('get', Routes.User('@me'), null, `Bearer ${res.access_token}`));
    if(!(user && user.id)) {
        console.warn('Verify: user request failed.');
        return 500;
    }

    if(user.id == client.user.id)
        return 418;

    let retCode;
    const userInfo = await usersDb.findOne({ _id: user.id });
    if(userInfo) {
        if(userInfo.xgmid == xgmid) {
            SendPM(user, 'Аккаунт уже подтвержден.');
            retCode = 208;
        } else {
            await usersDb.update({ _id: user.id }, { xgmid });
            SendMessage(config.channel.log, `Перепривязка аккаунта XGM ${UserMention(user)} :white_check_mark: ${XgmUserLink(xgmid)}\nСтарый аккаунт был <${XgmUserLink(userInfo.xgmid)}>`);
            SendPM(user, `:white_check_mark: Аккаунт перепривязан!\n${XgmUserLink(xgmid)}`);
            retCode = 200;
        }
    } else {
        const clone = await usersDb.findOne({ xgmid });
        if(clone) {
            console.log(`Verify: remove ${user.id}`);
            await usersDb.remove({ xgmid });
            const member = ConnectedServers.get(config.server).members.get(clone._id);
            if(member) {
                RemoveRole(config.server, member.user, config.role.user);
                RemoveRole(config.server, member.user, config.role.twilight);
            }
        }

        console.log(`Verify: ${user.id} -> ${xgmid}`);
        await usersDb.insert({ _id: user.id, xgmid });

        SendMessage(config.channel.log, clone ?
            `Перепривязка аккаунта Discord ${UserMention(user)} :white_check_mark: ${XgmUserLink(xgmid)}\nСтарый аккаунт был ${UserMention(clone._id)}` :
            `Привязка аккаунта ${UserMention(user)} :white_check_mark: ${XgmUserLink(xgmid)}`
        );
        SendPM(user, `:white_check_mark: Аккаунт подтвержден!\n${XgmUserLink(xgmid)}`);

        retCode = 200;
    }

    const member = ConnectedServers.get(config.server).members.get(user.id);
    if(member) {
        AddRole(config.server, user, config.role.user);
        CheckTwilight(config.server, member, xgmid);
    }

    return { code: retCode, content: user.id };
};

const webApiFuncs = {
    '/verify': async (request, response) => {
        const
            code = request.headers.code,
            xgmid = Number(request.headers.userid);

        if(!(code && (xgmid > 0)))
            return response.statusCode = 400;

        const ret = await VerifyUser(code, xgmid);
        if(ret.code) {
            response.statusCode = ret.code;
            if(ret.content) {
                response.setHeader('Content-Length', Buffer.byteLength(ret.content));
                response.write(ret.content);
            }
        } else {
            response.statusCode = ret;
        }
    },

    '/delete': async (request, response) => {
        const xgmid = Number(request.headers.userid);
        if(!(xgmid > 0))
            return response.statusCode = 400;

        if(userInfo._id == client.user.id)
            return response.statusCode = 418;

        const userInfo = await usersDb.findOne({ xgmid });
        if(!userInfo)
            return response.statusCode = 406;

        const data = await SafePromise(Misc.ReadIncomingData(request));

        console.log(`Verify: delete! ${userInfo._id}`);
        await usersDb.remove({ xgmid });
        SendMessage(config.channel.log, `Отвязка аккаунта ${UserMention(userInfo._id)} :no_entry: ${XgmUserLink(xgmid)}` + (data ? `\n**Причина:** ${data.toString()}` : ''));

        if(ConnectedServers.get(config.server).members.has(userInfo._id))
            RemoveRole(config.server, userInfo._id, config.role.user);

        SendPM(userInfo._id, ':no_entry: Аккаунт деавторизован, так как был удален.');

        response.statusCode = 200;
    },

    '/update-global-status': async (request, response) => {
        const xgmid = Number(request.headers.userid);
        if(!(xgmid > 0))
            return response.statusCode = 400;

        if(userInfo._id == client.user.id)
            return response.statusCode = 418;

        const status = request.headers.status || '';
        console.log(`S: ${xgmid} - '${status}'`);

        const userInfo = await usersDb.findOne({ xgmid });
        if(!userInfo)
            return response.statusCode = 200;

        const member = ConnectedServers.get(config.server).members.get(userInfo._id);

        if(status == 'readonly') {
            if(member && !HasRole(member, config.role.readonly))
                SafePromise(AddRole(config.server, userInfo._id, config.role.readonly));
            SafePromise(SendMessage(config.channel.log, `Пользователь ${UserMention(userInfo._id)} получил **Read only** на сайте.\n${XgmUserLink(xgmid)}`));
        } else if(status == 'suspended') {
            SafePromise(BanUser(config.server, userInfo._id, 'Бан на сайте'));
            SafePromise(SendMessage(config.channel.log, `Пользователь ${UserMention(userInfo._id)} получил бан на сайте.\n${XgmUserLink(xgmid)}`));
        } else {
            if(member) {
                if(HasRole(member, config.role.readonly))
                    SafePromise(RemoveRole(config.server, userInfo._id, config.role.readonly));
            } else {
                SafePromise(UnbanUser(config.server, userInfo._id));
            }
        }

        response.statusCode = 200;
    },

    '/pm': async (request, response) => {
        const xgmid = Number(request.headers.userid);
        if(!(xgmid > 0))
            return response.statusCode = 400;

        if(userInfo._id == client.user.id)
            return response.statusCode = 418;

        const userInfo = await usersDb.findOne({ xgmid });
        if(!userInfo)
            return response.statusCode = 406;

        const data = await SafePromise(Misc.ReadIncomingData(request));
        if(!data)
            return response.statusCode = 400;

        const text = data.toString();
        SendPM(userInfo._id, (text.length > 2000) ? text.substring(0, 1999) : text);

        response.statusCode = 200;
    },

    '/send': async (request, response) => {
        const channelid = request.headers.channelid;
        if(!channelid)
            return response.statusCode = 400;

        const data = await SafePromise(Misc.ReadIncomingData(request));
        if(!data)
            return response.statusCode = 400;

        const text = data.toString();
        try {
            await SendMessage(channelid, (text.length > 2000) ? text.substring(0, 1999) : text);
            response.statusCode = 200;
        } catch(e) {
            console.warn(e);
            response.statusCode = 403;
        }
    },

    '/sys': async (request, response) => {
        const data = await SafePromise(Misc.ReadIncomingData(request));
        if(!data)
            return response.statusCode = 400;

        const text = data.toString();
        try {
            await SendMessage(config.channel.system, (text.length > 2000) ? text.substring(0, 1999) : text);
            response.statusCode = 200;
        } catch(e) {
            console.warn(e);
            response.statusCode = 403;
        }

        response.statusCode = 200;
    },
};

const HandleRequest = async (request, response) => {
    if(request.method != 'POST')
        return response.statusCode = 405;

    if(request.headers.authorization != AUTH_SVC)
        return response.statusCode = 401;

    if(!(request.url && webApiFuncs.hasOwnProperty(request.url)))
        return response.statusCode = 404;

    console.log(`POST '${request.url}'`);
    await webApiFuncs[request.url](request, response);
};

require('http').createServer(async (request, response) => {
    try {
        await HandleRequest(request, response);
    } catch(e) {
        console.error(e);
        response.statusCode = 500;
    }
    response.end();
}).listen(80);
