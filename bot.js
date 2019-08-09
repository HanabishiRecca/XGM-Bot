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

const
    Database = require('nedb-promise'),
    Discord = require('discord.js'),
    Misc = require('./misc.js'),
    config = require('./config.json'),
    marks = require('./marks.js').list;

const
    appDb = new Database({ filename: `${storagePath}/app.db`, autoload: true }),
    usersDb = new Database({ filename: `${storagePath}/users.db`, autoload: true }),
    warnsDb = new Database({ filename: `${storagePath}/warns.db`, autoload: true });

const client = new Discord.Client({
    disabledEvents: (() => {
        const events = [];
        for(const event in Discord.Constants.WSEvents)
            events.push(event);
        return events;
    })(),
});

client.on('disconnect', Shutdown);
client.on('error', () => console.error('Connection error!'));
client.on('reconnecting', () => console.warn('Reconnecting...'));
client.on('resume', () => console.warn('Connection restored'));
client.on('rateLimit', () => console.warn('Rate limit!'));

const
    warnPeriod = 86400000,
    Endpoints = Discord.Constants.Endpoints,
    FLAGS = Discord.Permissions.FLAGS,
    CDN = Discord.Constants.DefaultOptions.http.cdn,
    UserMention = user => `<@${user.id || user}>`,
    UserTag = user => `${user.username}#${user.discriminator}`,
    GetMember = (server, user) => client.rest.makeRequest('get', Endpoints.Guild(server).Member(user), true),
    GetServer = server => client.rest.makeRequest('get', Endpoints.Guild(server), true),
    AddRole = (server, user, role) => client.rest.makeRequest('put', Endpoints.Guild(server).Member(user).Role(role), true),
    RemoveRole = (server, user, role) => client.rest.makeRequest('delete', Endpoints.Guild(server).Member(user).Role(role), true),
    SendMessage = (channel, content, embed) => client.rest.makeRequest('post', Endpoints.Channel(channel).messages, true, { content, embed }),
    GetChannel = channel => client.rest.makeRequest('get', Endpoints.Channel(channel), true),
    GetUserChannel = user => client.rest.makeRequest('post', Endpoints.User(client.user).channels, true, { recipient_id: user.id || user }),
    AddReaction = (channel, message, emoji) => client.rest.makeRequest('put', Endpoints.Channel(channel).Message(message).Reaction(emoji).User('@me'), true),
    GetReactions = (channel, message, emoji) => client.rest.makeRequest('get', Endpoints.Channel(channel).Message(message).Reaction(emoji), true),
    CheckPermission = (permissions, flag) => ((permissions & FLAGS.ADMINISTRATOR) > 0) || ((permissions & flag) === flag);

const HasPermission = async (server, user, flag) => {
    if(!server.id)
        server = await GetServer(server);
    
    const roles = user.roles || (await GetMember(server, user.id || user)).roles;
    for(let i = 0; i < roles.length; i++) {
        const
            rid = roles[i],
            role = server.roles.find(elem => elem.id == rid);
        
        if(role && CheckPermission(role.permissions, flag))
            return true;
    }
    
    return false;
};

const commands = {
    verify: async message => {
        const member = await GetMember(message.guild_id, message.author);
        if(!member)
            return;
        
        if(await usersDb.findOne({ _id: message.author.id })) {
            message.reply('аккаунт уже подтвержден.');
            AddRole(message.guild_id, message.author, config.role.user);
            return;
        }
        
        const
            username = message.content.trim() || member.nick || message.author.username,
            response = JSON.parse(await Misc.HttpsGet(`https://xgm.guru/api_user.php?username=${encodeURIComponent(username)}`));
        
        if(!(response && response.info)) {
            message.reply(`пользователь с именем \`${username}\` не зарегистрирован на сайте.`);
            return;
        }
        
        if(await usersDb.findOne({ xgmid: response.info.user.id })) {
            message.reply(`пользователь \`${response.info.user.username}\` уже привязан к другому аккаунту Discord! :warning:`);
            return;
        }
        
        if(Misc.DecodeHtmlEntity(response.info.user.fields.discord) !== UserTag(message.author)) {
            message.reply(`пользователь \`${response.info.user.username}\` не подтвержден. :no_entry_sign:\nНеобходимо правильно указать в сайтовом профиле свой тег Discord: \`${UserTag(member.user)}\`\n<https://xgm.guru/profile>`);
            return;
        }
        
        await usersDb.insert({ _id: message.author.id, xgmid: response.info.user.id });
        message.reply(`пользователь \`${response.info.user.username}\` подтвержден! :white_check_mark:`);
        AddRole(message.guild_id, message.author, config.role.user);
        
        if(response.info.user.seeTwilight)
            AddRole(message.guild_id, message.author, config.role.twilight);
    },
    
    whois: async message => {
        if(!(message.mentions && message.mentions.length))
            return;
        
        const userData = await usersDb.findOne({ _id: message.mentions[0].id });
        if(userData)
            message.reply(`https://xgm.guru/user/${userData.xgmid}`);
        else
            message.reply('пользователь не сопоставлен.');
    },
    
    warn: async message => {
        if(!(message.mentions && message.mentions.length))
            return;
        
        const server = await GetServer(message.guild_id);
        if(!HasPermission(server, message.member, FLAGS.MANAGE_MESSAGES))
            return;
        
        const userId = message.mentions[0].id;
        if(userId == client.user.id)
            return;
        
        const member = await GetMember(server, userId);
        if(!member || HasPermission(server, member, FLAGS.MANAGE_MESSAGES))
            return;
        
        const
            warnState = await warnsDb.findOne({ _id: member.user.id }),
            warns = warnState ? (warnState.warns + 1) : 0;
        
        await warnsDb.update({ _id: member.user.id }, { $set: { warns: warns, dt: Date.now() } }, { upsert: true });
        
        const pmChannel = await GetUserChannel(member.user);
        SendMessage(message.channel_id, `Пользователь ${UserMention(member.user)} получил предупреждение ${warns}/${config.maxWarns}!\nВыдано модератором ${UserMention(message.author)}`);
        SendMessage(pmChannel, `Вы получили предупреждение ${warns}/${config.maxWarns}!`);
        
        if(warns >= config.maxWarns) {
            AddRole(server, member.user, config.role.readonly);
            const time = Misc.FormatWarnTime(((warns - config.maxWarns) + 1) * warnPeriod);
            SendMessage(message.channel_id, `Пользователь ${UserMention(message.author)} превысил лимит предупреждений и получили статус **Read only**! Истекает через: ${time}`);
            SendMessage(pmChannel, `Вы превысили лимит предупреждений и получил статус **Read only**! Истекает через: ${time}`);
        }
    },
    
    status: async message => {
        if(!HasPermission(message.guild_id, message.member, FLAGS.MANAGE_MESSAGES))
            return;
        
        const
            warnStates = await warnsDb.find({}),
            now = Date.now();
        
        let text = `**Нарушителей:** ${warnStates.length}\n\n`;
        for(let i = 0; i < warnStates.length; i++) {
            const
                warnState = warnStates[i],
                end = (warnState.warns < config.maxWarns) ? '\n' : `, в **Read only** на ${Misc.FormatWarnTime(warnState.dt + ((warnState.warns - config.maxWarns + 1) * warnPeriod) - now)}`,
                add = `${UserMention(warnState._id)}, нарушения ${warnState.warns}/${config.maxWarns}, снятие через ${Misc.FormatWarnTime(warnState.dt + warnPeriod - now)}${end}`;
            
            if(text.length + add.length < 2000) {
                text += add;
            } else {
                await SendMessage(message.channel_id, text);
                text = add;
            }
        }
        
        SendMessage(message.channel_id, text);
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

const ReactionProc = async (reaction, add) => {
    const mark = marks.find(elem => ((elem.channel == reaction.channel_id) && (elem.message == reaction.message_id) && (elem.emoji == reaction.emoji.id)));
    if(mark)
        (add ? AddRole : RemoveRole)(reaction.guild_id, reaction.user_id, mark.role);
};

const SetMarks = async () => {
    const
        server = await GetServer(config.server),
        emojis = new Map();
    
    for(let i = 0; i < server.emojis.length; i++) {
        const emoji = server.emojis[i];
        emojis.set(emoji.id, emoji);
    }
    
    for(let i = 0; i < marks.length; i++) {
        const
            mark = marks[i],
            emoji = emojis.get(mark.emoji);
        
        if(emoji) {
            const t = `${emoji.name}:${emoji.id}`;
            if((await GetReactions(mark.channel, mark.message, t)).length < 1)
                await AddReaction(mark.channel, mark.message, t);
        }
    }
};

const appOptions = {
    lastNewsTime: { _id: 'lastNewsTime' },
};

const CheckNews = async () => {
    const feed = JSON.parse(await Misc.HttpsGet('https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fxgm.guru%2Frss'));
    if(!(feed && feed.items && feed.items.length))
        return;
    
    const
        option = await appDb.findOne(appOptions.lastNewsTime),
        lastTime = option ? option.value : Date.now(),
        items = feed.items;
    
    let maxTime = 0;
    for(let i = items.length - 1; i >= 0; i--) {
        const
            item = items[i],
            time = Date.parse(`${item.pubDate.replace(' ', 'T')}Z`);
        
        if(time > maxTime)
            maxTime = time;
        
        if(time > lastTime) {
            SendMessage(config.channel.news, '', {
                title: Misc.DecodeHtmlEntity(item.title),
                description: Misc.DecodeHtmlEntity(item.description.replace(/<\/?[^<>]*>/gm, '')),
                url: item.link,
                footer: { text: item.author },
                timestamp: new Date(time),
                color: 16764928,
                image: item.enclosure ? { url: item.enclosure.link } : null,
            });
        }
    }
    
    if(lastTime != maxTime)
        await appDb.update(appOptions.lastNewsTime, { $set: { value: maxTime } }, { upsert: true });
};

const CheckTwilight = async (server, user, xgmid) => {
    try {
        const response = JSON.parse(await Misc.HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`));
        if(response.info.user.seeTwilight && ((await GetMember(server, user)).roles.indexOf(config.role.twilight) < 0))
            await AddRole(server, user, config.role.twilight);
    } catch {}
};

const SyncTwilight = async () => {
    const users = await usersDb.find({});
    for(let i = 0; i < users.length; i++) {
        const userInfo = users[i];
        await CheckTwilight(config.server, userInfo._id, userInfo.xgmid);
    }
};

const EchoMessage = async (message, edit) => {
    if(message.channel_id == config.channel.echo)
        return;
    
    SendMessage(config.channel.echo, '', {
        description: message.content,
        timestamp: message.timestamp,
        author: {
            name: message.member.nick || message.author.username,
            icon_url: message.author.avatar ? `${CDN}/avatars/${message.author.id}/${message.author.avatar}` : `${CDN}/embed/avatars/0.png`,
        },
        footer: {
            text: `#${(await GetChannel(message.channel_id)).name}`,
        },
        title: edit ? '*(ред.)*' : null,
    });
};

const events = {
    READY: async data => {
        console.log('READY');
        
        if(client.user)
            return;
        
        client.user = data.user;
        
        SetMarks();
        
        WarnTick();
        client.setInterval(WarnTick, 60000);
        
        CheckNews();
        client.setInterval(CheckNews, 600000);
        
        SyncTwilight();
    },
    
    MESSAGE_CREATE: async message => {
        if(!(message.content && message.guild_id))
            return;
        
        if(message.author.id == client.user.id)
            return;
        
        EchoMessage(message, false);
        
        if(!message.content.startsWith(config.prefix))
            return;
        
        const
            si = message.content.search(/(\s|\n|$)/),
            command = commands[message.content.substring(config.prefix.length, (si > 0) ? si : undefined).toLowerCase()];
        
        if(!command)
            return;
        
        message.content = message.content.substring((si > 0) ? (si + 1) : '');
        message.reply = content => SendMessage(message.channel_id, `${UserMention(message.author)}, ${content}`);
        command(message);
    },
    
    MESSAGE_UPDATE: async message => {
        if(!(message.content && message.guild_id))
            return;
        
        if(message.author.id == client.user.id)
            return;
        
        EchoMessage(message, true);
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
    },
    
    GUILD_MEMBER_REMOVE: async member => {
        SendMessage(config.channel.log, `<:zminus:544205486073839616> ${UserMention(member.user)} покинул сервер.`);
    },
    
    MESSAGE_REACTION_ADD: async reaction => {
        if(client.user.id != reaction.user_id)
            ReactionProc(reaction, true);
    },
    
    MESSAGE_REACTION_REMOVE: async reaction => {
        if(client.user.id != reaction.user_id)
            ReactionProc(reaction, false);
    },
};

client.on('raw', async packet => {
    const event = events[packet.t];
    if(event)
        event(packet.d);
});

client.manager.connectToWebSocket(process.env.TOKEN, () => {}, () => {});
