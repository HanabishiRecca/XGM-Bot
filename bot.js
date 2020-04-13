'use strict';

require('./log.js');

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

const Shutdown = err => {
    console.error(err);
    process.exit(1);
};

if(!process.env.TOKEN)
    Shutdown('Token required.');

const storagePath = process.env.STORAGE;
if(!storagePath)
    Shutdown('Storage path required.');

if(global.gc)
    setInterval(global.gc, 3600000);

const
    Database = require('nedb-promise'),
    MariaDB = require('mariadb'),
    Discord = require('discordlite'),
    XmlParser = require('fast-xml-parser'),
    Misc = require('./misc.js'),
    config = require('./config.json');

const
    appDb = new Database({ filename: `${storagePath}/app.db`, autoload: true }),
    usersDb = new Database({ filename: `${storagePath}/users.db`, autoload: true }),
    warnsDb = new Database({ filename: `${storagePath}/warns.db`, autoload: true });

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
client.on('error', console.error);
client.on('warn', console.warn);

const
    warnPeriod = 86400000,
    Routes = Discord.Routes,
    Permissions = Discord.Permissions,
    ConnectedServers = new Map(),
    SafePromise = promise => new Promise(resolve => promise.then(result => resolve(result)).catch(() => resolve(null)));

const
    AddReaction = (channel, message, emoji) => client.Request('put', Routes.Reaction(channel, message, emoji) + '/@me'),
    AddRole = (server, user, role) => client.Request('put', Routes.Role(server, user, role)),
    GetMessage = (channel, message) => client.Request('get', Routes.Message(channel, message)),
    GetUser = userId => client.Request('get', Routes.User(userId)),
    GetUserChannel = user => client.Request('post', Routes.User('@me') + '/channels', { recipient_id: user.id || user }),
    RemoveRole = (server, user, role) => client.Request('delete', Routes.Role(server, user, role)),
    SendMessage = (channel, content, embed) => client.Request('post', Routes.Channel(channel) + '/messages', { content, embed });

const
    ChannelMention = channel => `<#${channel.id || channel}>`,
    CheckPermission = (permissions, flag) => ((permissions & Permissions.ADMINISTRATOR) > 0) || ((permissions & flag) === flag),
    UserMention = user => `<@${user.id || user}>`;

const HasPermission = (server, member, flag) => {
    const
        serverRoles = server.roles,
        roles = member.roles;

    for(let i = 0; i < roles.length; i++) {
        const role = serverRoles.get(roles[i]);
        if(role && CheckPermission(role.permissions, flag))
            return true;
    }

    return false;
};

const FormatWarn = (warnState, time) => {
    const result = `Нарушения ${warnState.warns}/${config.maxWarns}, снятие через ${Misc.FormatWarnTime(warnState.dt + warnPeriod - time)}`;
    return (warnState.warns < config.maxWarns) ? result : `${result}, в **Read only** на ${Misc.FormatWarnTime(warnState.dt + ((warnState.warns - config.maxWarns + 1) * warnPeriod) - time)}`;
};

const SendPM = async (user, msg) => await SafePromise(SendMessage(await GetUserChannel(user), msg));

const botCommands = {
    help: async message => {
        SendMessage(message.channel_id, `**Справка**

**Команды для всех**
\`whois @user\` - получить информацию о привязке указанного пользователя.
\`status\` - узнать свой статус предупреждений.
\`help\` - показать данное сообщение.

**Команды для модераторов**
\`warn @user\` - выдать предупреждение указанному пользователю.
\`list\` - показать список нарушителей.

*Команды можно отправлять боту в ЛС.*`);
    },

    whois: async message => {
        if(!(message.mentions && message.mentions.length))
            return;

        const userData = await usersDb.findOne({ _id: message.mentions[0] });
        message.reply(userData ? `https://xgm.guru/user/${userData.xgmid}` : 'Пользователь не сопоставлен.');
    },

    warn: async message => {
        if(!(message.mentions && message.mentions.length))
            return;

        if(!HasPermission(message.server, message.member, Permissions.MANAGE_MESSAGES))
            return;

        const userId = message.mentions[0];
        if(userId == client.user.id)
            return;

        const user = await SafePromise(GetUser(userId));
        if(!user)
            return message.reply('Указанный пользователь не существует.');

        const member = message.server.members.get(user.id);
        if(member && HasPermission(message.server, member, Permissions.MANAGE_MESSAGES))
            return;

        const
            warnState = await warnsDb.findOne({ _id: user.id }),
            warns = warnState ? (warnState.warns + 1) : 1;

        if(warns >= config.maxWarns)
            SafePromise(AddRole(message.server, user, config.role.readonly));

        await warnsDb.update({ _id: user.id }, { $set: { warns: warns, dt: Date.now() } }, { upsert: true });

        SendMessage(config.channel.log, `Пользователь ${UserMention(user)} получил предупреждение ${warns}/${config.maxWarns}!\nВыдано модератором ${UserMention(message.author)}`);
        SendPM(user, `Вы получили предупреждение ${warns}/${config.maxWarns}!`);
    },

    list: async message => {
        if(!HasPermission(message.server, message.member, Permissions.MANAGE_MESSAGES))
            return;

        const
            warnStates = await warnsDb.find({}),
            now = Date.now();

        let text = `**Нарушителей:** ${warnStates.length}\n\n`;
        for(let i = 0; i < warnStates.length; i++) {
            const
                warnState = warnStates[i],
                add = `${UserMention(warnState._id)} → ${FormatWarn(warnState, now)}\n`;

            if(text.length + add.length < 2000) {
                text += add;
            } else {
                SendMessage(message.channel_id, text);
                text = add;
            }
        }

        SendMessage(message.channel_id, text);
    },

    status: async message => {
        const warnState = await warnsDb.findOne({ _id: message.author.id });
        message.reply(warnState ? FormatWarn(warnState, Date.now()) : 'Нет предупреждений.');
    },
};

const WarnTick = async () => {
    const warnStates = await warnsDb.find({});
    if(warnStates.length < 1)
        return;

    const now = Date.now();
    for(let i = 0; i < warnStates.length; i++) {
        const warnState = warnStates[i];
        if((warnState.dt + warnPeriod) > now)
            continue;

        warnState.warns--;

        if(warnState.warns > 0)
            await warnsDb.update({ _id: warnState._id }, { $set: { warns: warnState.warns, dt: warnState.dt + warnPeriod } });
        else
            await warnsDb.remove({ _id: warnState._id });

        if(warnState.warns < config.maxWarns)
            SafePromise(RemoveRole(config.server, warnState._id, config.role.readonly));
    }
};

setInterval(WarnTick, 60000);

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
    if(mark)
        (add ? AddRole : RemoveRole)(reaction.guild_id, reaction.user_id, mark.role);
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

    const feed = XmlParser.parse(Misc.Win1251ToUtf8(data), { ignoreAttributes: false, attributeNamePrefix: '' });
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

const CheckTwilight = async (server, member, xgmid) => {
    const response = JSON.parse(await Misc.HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`));
    if(!response)
        return;

    if(response.info.user.seeTwilight) {
        if(member.roles.indexOf(config.role.twilight) < 0)
            await AddRole(server, member.user, config.role.twilight);
    } else {
        if(member.roles.indexOf(config.role.twilight) > -1)
            await RemoveRole(server, member.user, config.role.twilight);
    }
};

const SyncTwilight = async () => {
    const
        server = ConnectedServers.get(config.server),
        users = await usersDb.find({});

    for(let i = 0; i < users.length; i++) {
        const
            userInfo = users[i],
            member = server.members.get(userInfo._id);

        if(member)
            await CheckTwilight(server, member, userInfo.xgmid);
    }
};

setInterval(SyncTwilight, 3600000);

const SaveMessage = async message => {
    if(!mdbConnectionOptions)
        return;

    if(!(message.content && message.guild_id))
        return;

    const connection = await MariaDB.createConnection(mdbConnectionOptions);
    try {
        await connection.query({ namedPlaceholders: true, sql: 'insert into messages (id,user,text) values (:id,:user,:text) on duplicate key update text=:text;' }, { id: message.id, user: message.author.id, text: message.content });
    } catch (err) {
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
    } catch (err) {
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
            fields: [{
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
                    value: `${Discord.WebHost}/channels/${message.guild_id}/${message.channel_id}/${message.id}`,
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
            fields: [{
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

        const warnState = await warnsDb.findOne({ _id: member.user.id });
        if(warnState && (warnState.warns >= config.maxWarns))
            AddRole(member.guild_id, member.user, config.role.readonly);

        const userInfo = await usersDb.findOne({ _id: member.user.id });
        if(userInfo) {
            AddRole(member.guild_id, member.user, config.role.user);
            CheckTwilight(member.guild_id, member, userInfo.xgmid);
        }
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

        if((server.id == config.server) && (chunk.members.length < 1000))
            SyncTwilight();
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
client.Connect();

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

    let retCode;
    if(await usersDb.findOne({ _id: user.id })) {
        SendPM(user, 'Аккаунт уже подтвержден.');
        retCode = 208;
    } else {
        const clone = await usersDb.findOne({ xgmid });
        if(clone) {
            console.log(`Verify: remove ${user.id}`);
            await usersDb.remove({ xgmid });
        }
        
        console.log(`Verify: ${user.id} -> ${xgmid}`);
        await usersDb.insert({ _id: user.id, xgmid });
        
        SendMessage(config.channel.log, clone ?
            `Перепривязка аккаунта ${UserMention(user)} → https://xgm.guru/user/${xgmid}\nСтарый аккаунт был ${UserMention(clone._id)}` :
            `Привязка аккаунта ${UserMention(user)} → https://xgm.guru/user/${xgmid}`
        );
        SendPM(user, ':white_check_mark: Аккаунт подтвержден!');
        
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
};

const HandleRequest = async (request, response) => {
    if(request.method != 'POST')
        return response.statusCode = 405;

    if(request.headers.authorization != AUTH_SVC)
        return response.statusCode = 401;

    if(!(request.url && webApiFuncs.hasOwnProperty(request.url)))
        return response.statusCode = 404;

    await webApiFuncs[request.url]();
};

require('http').createServer(async (request, response) => {
    try {
        await HandleRequest(request, response);
    } catch (e) {
        console.error(e);
        response.statusCode = 500;
    }
    response.end();
}).listen(80);
