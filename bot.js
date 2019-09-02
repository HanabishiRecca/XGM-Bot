'use strict';

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
    Discord = require('discord.js'),
    XmlParser = require('fast-xml-parser'),
    Misc = require('./misc.js'),
    config = require('./config.json');

const
    appDb = new Database({ filename: `${storagePath}/app.db`, autoload: true }),
    usersDb = new Database({ filename: `${storagePath}/users.db`, autoload: true }),
    warnsDb = new Database({ filename: `${storagePath}/warns.db`, autoload: true });

const mdbConnectionOptions = process.env.MDB_HOST ? {
    host: process.env.MDB_HOST,
    database: process.env.MDB_DATABASE,
    user: process.env.MDB_USER,
    password: process.env.MDB_PASSWORD,
    bigNumberStrings: true,
} : null;

const client = new Discord.Client({
    disabledEvents: (() => {
        const events = [];
        for(const event in Discord.Constants.WSEvents)
            events.push(event);
        return events;
    })(),
});

client.on('disconnect', Shutdown);
client.on('reconnecting', () => console.warn('Reconnect'));
client.on('error', () => console.error('Connection error!'));
client.on('resume', () => console.warn('Connection restored'));
client.on('rateLimit', () => console.warn('Rate limit!'));

const
    warnPeriod = 86400000,
    Endpoints = Discord.Constants.Endpoints,
    FLAGS = Discord.Permissions.FLAGS,
    ConnectedServers = new Map(),
    SafePromise = promise => new Promise(resolve => promise.then(result => resolve(result)).catch(() => resolve(null)));

const
    AddReaction = (channel, message, emoji) => client.rest.makeRequest('put', Endpoints.Channel(channel).Message(message).Reaction(emoji).User('@me'), true),
    AddRole = (server, member, role) => client.rest.makeRequest('put', Endpoints.Guild(server).Member(member).Role(role), true),
    GetMessage = (channel, message) => client.rest.makeRequest('get', Endpoints.Channel(channel).Message(message), true),
    GetUser = userId => client.rest.makeRequest('get', Endpoints.User(userId), true),
    GetUserChannel = user => client.rest.makeRequest('post', Endpoints.User(client.user).channels, true, { recipient_id: user.id || user }),
    RemoveRole = (server, member, role) => client.rest.makeRequest('delete', Endpoints.Guild(server).Member(member).Role(role), true),
    SendMessage = (channel, content, embed) => client.rest.makeRequest('post', Endpoints.Channel(channel).messages, true, { content, embed });

const
    ChannelMention = channel => `<#${channel.id || channel}>`,
    CheckPermission = (permissions, flag) => ((permissions & FLAGS.ADMINISTRATOR) > 0) || ((permissions & flag) === flag),
    ServerMember = (server, user) => server.members.find(member => member && (member.user.id == user.id)),
    UserMention = user => `<@${user.id || user}>`;

const HasPermission = async (server, member, flag) => {
    const roles = member.roles;
    for(let i = 0; i < roles.length; i++) {
        const
            rid = roles[i],
            role = server.roles.find(elem => elem.id == rid);
        
        if(role && CheckPermission(role.permissions, flag))
            return true;
    }
    
    return false;
};

const FormatWarn = (warnState, time) => {
    const result = `Нарушения ${warnState.warns}/${config.maxWarns}, снятие через ${Misc.FormatWarnTime(warnState.dt + warnPeriod - time)}`;
    return (warnState.warns < config.maxWarns) ? result : `${result}, в **Read only** на ${Misc.FormatWarnTime(warnState.dt + ((warnState.warns - config.maxWarns + 1) * warnPeriod) - time)}`;
};

const commands = {
    verify: async message => {
        if(await usersDb.findOne({ _id: message.author.id })) {
            message.reply('Аккаунт уже подтвержден.');
            AddRole(message.server, message.member, config.role.user);
            return;
        }
        
        const
            username = message.content.trim() || ServerMember(message.server, message.author).nick || message.author.username,
            response = JSON.parse(await Misc.HttpsGet(`https://xgm.guru/api_user.php?username=${encodeURIComponent(username)}`));
        
        if(!(response && response.info)) {
            message.reply(`Пользователь с именем \`${username}\` не зарегистрирован на сайте.`);
            return;
        }
        
        const xgmid = response.info.user.id;
        if(await usersDb.findOne({ xgmid })) {
            message.reply(`Пользователь \`${response.info.user.username}\` уже привязан к другому аккаунту Discord! :warning:`);
            return;
        }
        
        if(Misc.DecodeHtmlEntity(response.info.user.fields.discord) !== `${message.author.username}#${message.author.discriminator}`) {
            message.reply(`Пользователь \`${response.info.user.username}\` не подтвержден. :no_entry_sign:\nНеобходимо правильно указать в сайтовом профиле свой тег Discord: **${message.author.username}**\`#${message.author.discriminator}\`\n<https://xgm.guru/profile>`);
            return;
        }
        
        await usersDb.insert({ _id: message.author.id, xgmid });
        message.reply(`Пользователь \`${response.info.user.username}\` подтвержден! :white_check_mark:`);
        SendMessage(config.channel.log, `Привязка аккаунта ${UserMention(message.author)} → ID ${xgmid}`);
        
        AddRole(message.server, message.member, config.role.user);
        if(response.info.user.seeTwilight)
            AddRole(message.server, message.member, config.role.twilight);
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
        
        if(!HasPermission(message.server, message.member, FLAGS.MANAGE_MESSAGES))
            return;
        
        const userId = message.mentions[0];
        if(userId == client.user.id)
            return;
        
        const user = await SafePromise(GetUser(userId));
        if(!user) {
            message.reply('Указанный пользователь не существует.');
            return;
        }
        
        const member = ServerMember(message.server, user);
        if(member && HasPermission(message.server, member, FLAGS.MANAGE_MESSAGES))
            return;
        
        const
            warnState = await warnsDb.findOne({ _id: user.id }),
            warns = warnState ? (warnState.warns + 1) : 1;
        
        if(warns >= config.maxWarns)
            AddRole(message.server, user, config.role.readonly);
        
        await warnsDb.update({ _id: user.id }, { $set: { warns: warns, dt: Date.now() } }, { upsert: true });
        
        SendMessage(config.channel.log, `Пользователь ${UserMention(user)} получил предупреждение ${warns}/${config.maxWarns}!\nВыдано модератором ${UserMention(message.author)}`);
        SendMessage(await GetUserChannel(user), `Вы получили предупреждение ${warns}/${config.maxWarns}!`);
    },
    
    list: async message => {
        if(!HasPermission(message.server, message.member, FLAGS.MANAGE_MESSAGES))
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
        message.reply(warnState ? FormatWarn(warnState, Date.now()) : 'Нет нарушений.');
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
            RemoveRole(config.server, warnState._id, config.role.readonly);
    }
};

client.setInterval(WarnTick, 60000);

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
    const feed = XmlParser.parse(Misc.Win1251ToUtf8(await Misc.HttpsGet('https://xgm.guru/rss')), { ignoreAttributes: false, attributeNamePrefix: '' });
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

client.setInterval(CheckNews, 600000);

const CheckTwilight = async (server, member, xgmid) => {
    try {
        const response = JSON.parse(await Misc.HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`));
        if(response.info.user.seeTwilight && (member.roles.indexOf(config.role.twilight) < 0))
            await AddRole(server, member, config.role.twilight);
    } catch {}
};

const SyncTwilight = async () => {
    const
        server = ConnectedServers.get(config.server),
        users = await usersDb.find({});
    
    for(let i = 0; i < users.length; i++) {
        const
            userInfo = users[i],
            member = ServerMember(server, { id: userInfo._id });
        
        if(member)
            await CheckTwilight(server, member, userInfo.xgmid);
    }
};

client.setInterval(SyncTwilight, 3600000);

const SaveMessage = async message => {
    if(!mdbConnectionOptions)
        return;
    
    if(message.channel_id == config.channel.log)
        return;
    
    if(!(message.content && message.guild_id))
        return;
    
    if(message.author.id == client.user.id)
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

const ServerUpdate = server => {
    ConnectedServers.set(server.id, {
        id: server.id,
        roles: server.roles,
        members: server.members,
    });
};

const events = {
    READY: async data => {
        console.log('INIT');
        
        client.user = data.user;
        
        let serverEmojis;
        const ClientReady = () => {
            SetMarks(serverEmojis);
            SyncTwilight();
            CheckNews();
            console.log('READY');
        };
        
        const
            serverCount = data.guilds.length,
            origFunc = events.GUILD_CREATE;
        
        let connected = 0;
        events.GUILD_CREATE = async server => {
            ServerUpdate(server);
            connected++;
            
            if(server.id == config.server)
                serverEmojis = server.emojis;
            
            if(connected < serverCount)
                return;
            
            events.GUILD_CREATE = origFunc;
            ClientReady();
        };
    },
    
    MESSAGE_CREATE: async message => {
        if(!message.content)
            return;
        
        if(message.author.id == client.user.id)
            return;
        
        SaveMessage(message);
        
        if(!message.content.startsWith(config.prefix))
            return;
        
        const
            si = message.content.search(/(\s|\n|$)/),
            command = commands[message.content.substring(config.prefix.length, (si > 0) ? si : undefined).toLowerCase()];
        
        if(!command)
            return;
        
        message.content = message.content.substring((si > 0) ? (si + 1) : '');
        message.mentions = Misc.GetMentions(message.content);
        message.reply = content => SendMessage(message.channel_id, message.guild_id ? `${UserMention(message.author)}\n${content}` : content);
        
        message.server = ConnectedServers.get(message.guild_id) || ConnectedServers.get(config.server);
        
        if(!message.member)
            message.member = ServerMember(message.server, message.author);
        
        command(message);
    },
    
    MESSAGE_UPDATE: async message => {
        SaveMessage(message);
    },
    
    MESSAGE_DELETE: async message => {
        if(message.channel_id == config.channel.deleted)
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
                    value: result.text,
                },
            ],
            timestamp: new Date(result.dt),
        });
    },
    
    GUILD_MEMBER_ADD: async member => {
        SendMessage(config.channel.log, `<:zplus:544205514943365123> ${UserMention(member.user)} присоединился к серверу.`);
        
        const warnState = await warnsDb.findOne({ _id: member.user.id });
        if(warnState && (warnState.warns >= config.maxWarns))
            AddRole(member.guild_id, member.user, config.role.readonly);
        
        const userInfo = await usersDb.findOne({ _id: member.user.id });
        if(userInfo) {
            AddRole(member.guild_id, member.user, config.role.user);
            CheckTwilight(member.guild_id, member.user, userInfo.xgmid);
        }
        
        ConnectedServers.get(member.guild_id).members.unshift(member);
    },
    
    GUILD_MEMBER_REMOVE: async member => {
        SendMessage(config.channel.log, `<:zminus:544205486073839616> ${UserMention(member.user)} покинул сервер.`);
        
        const
            members = ConnectedServers.get(member.guild_id).members,
            index = members.findIndex(elem => elem && (elem.user.id == member.user.id));
        
        if(index > -1)
            members[index] = null;
    },
    
    MESSAGE_REACTION_ADD: async reaction => {
        if(client.user.id != reaction.user_id)
            ReactionProc(reaction, true);
    },
    
    MESSAGE_REACTION_REMOVE: async reaction => {
        if(client.user.id != reaction.user_id)
            ReactionProc(reaction, false);
    },
    
    GUILD_CREATE: async server => {
        ServerUpdate(server);
    },
    
    GUILD_UPDATE: async server => {
        ServerUpdate(server);
    },
    
    GUILD_DELETE: async server => {
        ConnectedServers.delete(server.id);
    },
};

client.on('raw', async packet => {
    const event = events[packet.t];
    if(event)
        event(packet.d);
});

client.manager.connectToWebSocket(process.env.TOKEN, () => {}, () => {});
