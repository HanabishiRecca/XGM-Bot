import Logger from '../util/log.js';
import config from '../util/config.js';
import { SyncUser } from '../util/users.js';
import { GenMap } from '../util/misc.js';
import { Shutdown } from './process.js';
import { ConnectedServers, AuthUsers, AddServer, SendLogMsg, authorization } from './state.js';
import { SetMarks, ReactionProc } from './marks.js';
import { RegisterCommands, HandleInteraction } from './commands.js';
import { Client, ClientEvents, Events, Actions, Helpers, Tools } from 'discord-slim';

const client = new Client();

client.on(ClientEvents.CONNECT, () => Logger.Log('Connection established.'));
client.on(ClientEvents.DISCONNECT, (code) => Logger.Error(`Disconnect. (${code})`));
client.on(ClientEvents.WARN, Logger.Warn);
client.on(ClientEvents.ERROR, Logger.Error);
client.on(ClientEvents.FATAL, Shutdown);

const CheckUser = (id: string, flag: boolean) => {
    if(id == client.user?.id) return;

    const member = ConnectedServers.get(config.server)?.members.get(id);
    if(member?.user?.bot) return;

    const xgmid = AuthUsers.get(id);
    if(!xgmid) return;

    SyncUser(id, xgmid, flag, member).catch(Logger.Error);
};

client.events.on(Events.READY, ({ user: { id } }) => {
    ConnectedServers.clear();
    RegisterCommands(id);
    Logger.Log('READY');
});

client.events.on(Events.INTERACTION_CREATE, HandleInteraction);

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
    if(!member.user) return;
    const { guild_id, user: { id } } = member;
    ConnectedServers.get(guild_id)?.members.set(id, member);

    if(guild_id != config.server) return;
    SendLogMsg(`<:zplus:544205514943365123> ${Tools.Mention.User(id)} присоединился к серверу.`);
    CheckUser(id, false);
});

client.events.on(Events.GUILD_MEMBER_UPDATE, (member) => {
    const current = ConnectedServers.get(member.guild_id)?.members.get(member.user.id);
    current && Object.assign(current, member);
});

client.events.on(Events.GUILD_MEMBER_REMOVE, ({ guild_id, user: { id } }) => {
    ConnectedServers.get(guild_id)?.members.delete(id);

    if(guild_id != config.server) return;
    SendLogMsg(`<:zminus:544205486073839616> ${Tools.Mention.User(id)} покинул сервер.`);
});

client.events.on(Events.MESSAGE_REACTION_ADD, (reaction) => ReactionProc(reaction, true));
client.events.on(Events.MESSAGE_REACTION_REMOVE, (reaction) => ReactionProc(reaction, false));

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

client.events.on(Events.GUILD_MEMBERS_CHUNK, ({ guild_id, members }) => {
    const sm = ConnectedServers.get(guild_id)?.members;
    if(!sm) return;
    for(const member of members)
        member.user && sm.set(member.user.id, member);
});

client.events.on(Events.GUILD_ROLE_CREATE, ({ guild_id, role }) =>
    ConnectedServers.get(guild_id)?.roles.set(role.id, role));

client.events.on(Events.GUILD_ROLE_UPDATE, ({ guild_id, role }) => {
    const current = ConnectedServers.get(guild_id)?.roles.get(role.id);
    current && Object.assign(current, role);
});

client.events.on(Events.GUILD_ROLE_DELETE, ({ guild_id, role_id }) =>
    ConnectedServers.get(guild_id)?.roles.delete(role_id));

client.events.on(Events.GUILD_BAN_ADD, ({ guild_id, user: { id } }) =>
    (guild_id == config.server) && CheckUser(id, true));

client.events.on(Events.GUILD_BAN_REMOVE, ({ guild_id, user: { id } }) =>
    (guild_id == config.server) && CheckUser(id, false));

client.events.on(Events.CHANNEL_CREATE, (channel) =>
    channel.guild_id && ConnectedServers.get(channel.guild_id)?.channels.set(channel.id, channel));

client.events.on(Events.CHANNEL_UPDATE, (channel) => {
    if(!channel.guild_id) return;
    const current = ConnectedServers.get(channel.guild_id)?.channels.get(channel.id);
    current && Object.assign(current, channel);
});

client.events.on(Events.CHANNEL_DELETE, ({ guild_id, id }) =>
    guild_id && ConnectedServers.get(guild_id)?.channels.delete(id));

client.Connect(authorization, Helpers.Intents.SYSTEM
    | Helpers.Intents.GUILDS
    | Helpers.Intents.GUILD_MEMBERS
    | Helpers.Intents.GUILD_BANS
    | Helpers.Intents.GUILD_MESSAGES
    | Helpers.Intents.GUILD_MESSAGE_REACTIONS
);
