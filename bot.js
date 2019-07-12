'use strict';

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

function Shutdown(err) {
    console.error(err);
    process.exit(1);
}

if(!process.env.TOKEN)
    Shutdown('Token required.');

const
    Misc = require('./misc.js'),
    request = require('request-promise-native'),
    Database = require('nedb-promise'),
    Discord = require('discord.js'),
    XmlParser = require('fast-xml-parser');

const
    verifyCommand = '/verify',
    whoisCommand = '/whois',
    warnCommand = '/warn',
    statusCommand = '/status';

const
    userRoleId = '543458703807086602',
    readonlyRoleId = '544598116129832961',
    twilightRoleId = '572031693947666478';

const
    serverId = '543458159818440705',
    logChatId = '544576639636471808',
    newsChatId = '543461066596941857';

const
    appDb = new Database({ filename: './storage/app.db', autoload: true }),
    usersDb = new Database({ filename: './storage/users.db', autoload: true }),
    warnsDb = new Database({ filename: './storage/warns.db', autoload: true }),
    marksDb = new Database({ filename: './storage/marks.db', autoload: true });

const client = new Discord.Client({
    messageCacheMaxSize: 0,
    disabledEvents: ['GUILD_BAN_ADD', 'GUILD_BAN_REMOVE', 'CHANNEL_PINS_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE_BULK', 'USER_NOTE_UPDATE', 'USER_SETTINGS_UPDATE', 'PRESENCE_UPDATE', 'VOICE_STATE_UPDATE', 'TYPING_START', 'VOICE_SERVER_UPDATE', 'RELATIONSHIP_ADD', 'RELATIONSHIP_REMOVE'],
});

client.on('disconnect', Shutdown);
client.on('error', () => console.warn('Connection error!'));
client.on('reconnecting', () => console.warn('Reconnecting...'));
client.on('resume', () => console.warn('Connection restored'));
//client.on('rateLimit', console.warn);

async function ReceiveMessage(message) {
    if(!message.guild_id)
        return;
    
    if(message.author.id == client.user.id)
        return;
    
    if(message.content.startsWith(verifyCommand)) {
        CheckUser(message);
    } else if(message.content.startsWith(whoisCommand)) {
        Whois(message);
    } else if(message.content.startsWith(warnCommand)) {
        WarnUser(message);
    } else if(message.content.startsWith(statusCommand)) {
        ShowStatus(message);
    }
}

async function CheckUser(message) {
    const channel = client.channels.get(message.channel_id);
    
    message.reply = (msg) => {
        channel.send(msg, { reply: message.author.id });
    };
    
    const member = await client.guilds.get(message.guild_id).fetchMember(message.author.id, false);
    
    if(await usersDb.findOne({ _id: message.author.id })) {
        message.reply('аккаунт уже подтвержден.');
        member.addRole(userRoleId);
        return;
    }
    
    const username = message.content.substring(verifyCommand.length).trim() || member.displayName;
    try {
        const response = JSON.parse(await request({ uri: `https://xgm.guru/api_user.php?username=${encodeURIComponent(username)}`, simple: false }));
        if(response.info) {
            const data = await usersDb.findOne({ xgmid: response.info.user.id });
            if(data) {
                message.reply(`пользователь \`${response.info.user.username}\` уже привязан к другому аккаунту Discord! :warning:`);
            } else {
                if(Misc.DecodeHtmlEntity(response.info.user.fields.discord) === member.user.tag) {
                    usersDb.insert({ _id: message.author.id, xgmid: response.info.user.id });
                    message.reply(`пользователь \`${response.info.user.username}\` подтвержден! :white_check_mark:`);
                    member.addRole(userRoleId);
                    if(response.info.user.seeTwilight)
                        member.addRole(twilightRoleId);
                } else {
                    message.reply(`пользователь \`${response.info.user.username}\` не подтвержден. :no_entry_sign:\nНеобходимо правильно указать в сайтовом профиле свой тег Discord: \`${member.user.tag}\`\n<https://xgm.guru/profile>`);
                }
            }
        } else {
            message.reply(`пользователь с именем \`${username}\` не зарегистрирован на сайте.`);
        }
    } catch (err) {
        console.error(err);
        message.reply('что-то сломалось, разбудите админа!');
    }
}

async function Whois(message) {
    if(!(message.mentions && message.mentions.length))
        return;
    
    const
        channel = client.channels.get(message.channel_id),
        userData = await usersDb.findOne({ _id: message.mentions[0].id });
    
    if(userData)
        channel.send(`https://xgm.guru/user/${userData.xgmid}`, { reply: message.author.id });
    else
        channel.send('пользователь не сопоставлен.', { reply: message.author.id });
}

const
    maxWarns = 3,
    warnPeriod = 86400000;

async function WarnUser(message) {
    const author = await client.guilds.get(message.guild_id).fetchMember(message.author.id, false);
    if(!author.hasPermission(Discord.Permissions.FLAGS.MANAGE_MESSAGES))
        return;
    
    if(!(message.mentions && message.mentions.length))
        return;
    
    const userId = message.mentions[0].id;
    if(userId == client.id)
        return;
    
    const member = await client.guilds.get(message.guild_id).fetchMember(userId, false);
    if(!member || member.hasPermission(Discord.Permissions.FLAGS.MANAGE_MESSAGES))
        return;
    
    let warnState = await warnsDb.findOne({ _id: member.user.id });
    if(warnState) {
        warnState.warns++;
        warnsDb.update({ _id: warnState._id }, { $set: { warns: warnState.warns, dt: Date.now() } });
    } else {
        warnState = { _id: member.user.id, warns: 1, dt: Date.now() };
        warnsDb.insert(warnState);
    }
    
    const
        channel = client.channels.get(message.channel_id),
        wcstr = `${warnState.warns}/${maxWarns}`;
    
    channel.send(`Пользователь ${member.toString()} получил предупреждение ${wcstr}!\nВыдано модератором ${author.toString()}`);
    member.user.send(`Вы получили предупреждение ${wcstr}!`);
    
    if(warnState.warns >= maxWarns) {
        member.addRole(readonlyRoleId);
        const tstr = Misc.FormatWarnTime((warnState.warns - maxWarns + 1) * warnPeriod);
        channel.send(`Пользователь ${member.toString()} превысил лимит предупреждений и получили статус **Read only**! Истекает через: ${tstr}`);
        member.user.send(`Вы превысили лимит предупреждений и получил статус **Read only**! Истекает через: ${tstr}`);
    }
}

async function CheckWarn(warnState, now) {
    if(warnState.dt + warnPeriod > now)
        return;
    
    const removeReadOnly = (warnState.warns == maxWarns);
    warnState.warns--;
    
    if(warnState.warns > 0)
        warnsDb.update({ _id: warnState._id }, { $set: { warns: warnState.warns, dt: now } });
    else
        warnsDb.remove({ _id: warnState._id });
    
    if(removeReadOnly) {
        const member = await client.guilds.get(serverId).fetchMember(warnState._id, false);
        if(member)
            member.removeRole(readonlyRoleId);
    }
}

async function WarnTick() {
    const warnStates = await warnsDb.find({});
    if(warnStates.length < 1)
        return;
    
    const now = Date.now();
    for(let i = 0; i < warnStates.length; i++)
        CheckWarn(warnStates[i], now);
}

async function ShowStatus(message) {
    const author = await client.guilds.get(message.guild_id).fetchMember(message.author.id, false);
    if(!author.hasPermission(Discord.Permissions.FLAGS.MANAGE_MESSAGES))
        return;
    
    const
        warnStates = await warnsDb.find({}),
        now = Date.now();
    
    let answer = `Нарушителей: ${warnStates.length}`;
    
    for(let i = 0; i < warnStates.length; i++) {
        const warnState = warnStates[i];
        answer += `\n<@${warnState._id}>, нарушения ${warnState.warns}/${maxWarns}, снятие через ${Misc.FormatWarnTime(warnState.dt + warnPeriod - now)}`;
        if(warnState.warns >= maxWarns)
            answer += `, **в Read only на ${Misc.FormatWarnTime(warnState.dt + ((warnState.warns - maxWarns + 1) * warnPeriod) - now)}**`;
    }
    
    client.channels.get(message.channel_id).send(answer);
}

async function ReactionProc(reaction, add) {
    const mark = await marksDb.findOne({ channel: reaction.channel_id, message: reaction.message_id, emoji: reaction.emoji.id });
    if(!mark)
        return;
    
    const member = await client.guilds.get(reaction.guild_id).fetchMember(reaction.user_id, false);
    if(add)
        member.addRole(mark.role);
    else
        member.removeRole(mark.role);
}

async function ReceiveReactionAdd(reaction) {
    if(client.user.id != reaction.user_id)
        ReactionProc(reaction, true);
}

async function ReceiveReactionRemove(reaction) {
    ReactionProc(reaction, false);
}

async function SetMarks() {
    let marks = await marksDb.find({});
    for(let i = 0; i < marks.length; i++) {
        const mark = marks[i];
        await client.rest.methods.addMessageReaction({
            channel: { id: mark.channel },
            id: mark.message,
            client: client,
            _addReaction: () => {},
        }, client.emojis.get(mark.emoji).identifier);
    }
};

const lastNewsDateParamName = 'lastNewsDate';
let lastNewsDate;
async function InitNews() {
    const opt = await appDb.findOne({ _id: lastNewsDateParamName });
    if(opt) {
        lastNewsDate = opt.date;
    } else {
        lastNewsDate = Date.now();
        await appDb.insert({ _id: lastNewsDateParamName, date: lastNewsDate });
    }
}

async function CheckNews() {
    if(client.status)
        return;
    
    const feed = XmlParser.parse(Misc.Win1251ToUtf8(await request({ url: 'https://xgm.guru/rss', encoding: null })), { ignoreAttributes: false, attributeNamePrefix: '' });
    if(!(feed.rss && feed.rss.channel && feed.rss.channel.item))
        return;
    
    const pubTime = new Date(feed.rss.channel.pubDate).getTime();
    if(pubTime <= lastNewsDate)
        return;
    
    for(let i = feed.rss.channel.item.length - 1; i >= 0; i--) {
        const
            item = feed.rss.channel.item[i],
            time = new Date(item.pubDate);
        
        if(time.getTime() > lastNewsDate) {
            client.channels.get(newsChatId).send('', {
                embed: {
                    title: Misc.DecodeHtmlEntity(item.title),
                    description: Misc.DecodeHtmlEntity(item.description.replace(/<\/?[^<>]*>/gm, '')),
                    url: item.link,
                    footer: { text: item.author },
                    timestamp: time,
                    color: 16764928,
                    thumbnail: item.enclosure ? { url: item.enclosure.url } : null,
                }
            });
        }
    }
    lastNewsDate = pubTime;
    appDb.update({ _id: lastNewsDateParamName }, { $set: { date: lastNewsDate } });
}

client.on('raw', async (packet) => {
    if(packet.t == 'MESSAGE_CREATE') {
        ReceiveMessage(packet.d);
    } else if(packet.t == 'MESSAGE_REACTION_ADD') {
        ReceiveReactionAdd(packet.d);
    } else if(packet.t == 'MESSAGE_REACTION_REMOVE') {
        ReceiveReactionRemove(packet.d);
    }
});

async function NewMemberCheckRole(member) {
    if(await usersDb.findOne({ _id: member.user.id }))
        member.addRole(userRoleId);
}

async function NewMemberCheckWarns(member) {
    const warnState = await warnsDb.findOne({ _id: member.user.id });
    if(warnState && (warnState.warns >= maxWarns))
        member.addRole(readonlyRoleId);
}

async function CheckTwilight(member) {
    const userInfo = await usersDb.findOne({ _id: member.user.id });
    if(!userInfo)
        return;
    
    const response = JSON.parse(await request({ uri: `https://xgm.guru/api_user.php?id=${userInfo.xgmid}`, simple: false }));
    if(response && response.info && response.info.user && response.info.user.seeTwilight)
        member.addRole(twilightRoleId);
}

client.on('guildMemberAdd', async (member) => {
    client.channels.get(logChatId).send(`<:zplus:544205514943365123> ${member.toString()} присоединился к серверу.`);
    NewMemberCheckWarns(member);
    NewMemberCheckRole(member);
    CheckTwilight(member);
});

client.on('guildMemberRemove', async (member) => {
    client.channels.get(logChatId).send(`<:zminus:544205486073839616> ${member.toString()} покинул сервер.`);
});

async function SyncTwilight() {
    for(const member of client.guilds.get(serverId).members.values())
        if(member.roles.has(userRoleId) && !member.roles.has(twilightRoleId))
            await CheckTwilight(member);
}

client.on('ready', async () => {
    await InitNews();
    
    SetMarks();
    
    WarnTick();
    client.setInterval(WarnTick, 60000);
    
    CheckNews();
    client.setInterval(CheckNews, 600000);
    
    SyncTwilight();
    
    console.log('READY');
});

client.login(process.env.TOKEN);
