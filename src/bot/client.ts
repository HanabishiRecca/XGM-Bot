import Logger from '../util/log.js';
import config from '../util/config.js';
import { SyncUser } from '../util/users.js';
import { Shutdown } from './process.js';
import { AuthUsers, AddServer, GetServer, RemoveServer, RemoveAllServers, SendLogMsg, authorization } from './state.js';
import { SetMarks, ReactionProc } from './marks.js';
import { RegisterCommands, HandleInteraction } from './commands.js';
import { Client, ClientEvents, Events, Helpers, Tools, Types } from 'discord-slim';

const client = new Client();

client.on(ClientEvents.CONNECT, () => Logger.Log('Connection established.'));
client.on(ClientEvents.DISCONNECT, (code) => Logger.Error(`Disconnect. (${code})`));
client.on(ClientEvents.WARN, Logger.Warn);
client.on(ClientEvents.ERROR, Logger.Error);
client.on(ClientEvents.FATAL, Shutdown);

const CheckUser = (id: string, flag: boolean) => {
    if(id == client.user?.id) return;

    const member = GetServer(config.server)?.members.get(id);
    if(member?.user?.bot) return;

    const xgmid = AuthUsers.get(id);
    if(!xgmid) return;

    SyncUser(id, xgmid, flag, member).catch(Logger.Error);
};

client.events.on(Events.READY, ({ user: { id } }) => {
    RemoveAllServers();
    RegisterCommands(id);
    Logger.Log('READY');
});

client.events.on(Events.INTERACTION_CREATE, HandleInteraction);

client.events.on(Events.GUILD_MEMBER_ADD, async (member) => {
    if(!member.user) return;
    const { guild_id, user: { id } } = member;
    GetServer(guild_id)?.members.set(id, member);

    if(guild_id != config.server) return;
    SendLogMsg(`<:zplus:544205514943365123> ${Tools.Mention.User(id)} присоединился к серверу.`);
    CheckUser(id, false);
});

client.events.on(Events.GUILD_MEMBER_UPDATE, (member) => {
    const { guild_id, user: { id } } = member;
    GetServer(guild_id)?.members.set(id, member as Types.Member);
    CheckUser(id, false);
});

client.events.on(Events.GUILD_MEMBER_REMOVE, ({ guild_id, user: { id } }) => {
    GetServer(guild_id)?.members.delete(id);

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

client.events.on(Events.GUILD_DELETE, ({ unavailable, id }) =>
    unavailable || RemoveServer(id));

client.events.on(Events.GUILD_MEMBERS_CHUNK, ({ guild_id, members }) => {
    const sm = GetServer(guild_id)?.members;
    if(!sm) return;
    for(const member of members)
        member.user && sm.set(member.user.id, member);
});

client.events.on(Events.GUILD_BAN_ADD, ({ guild_id, user: { id } }) =>
    (guild_id == config.server) && CheckUser(id, true));

client.events.on(Events.GUILD_BAN_REMOVE, ({ guild_id, user: { id } }) =>
    (guild_id == config.server) && CheckUser(id, false));

client.Connect(authorization, Helpers.Intents.SYSTEM
    | Helpers.Intents.GUILDS
    | Helpers.Intents.GUILD_MEMBERS
    | Helpers.Intents.GUILD_BANS
    | Helpers.Intents.GUILD_MESSAGE_REACTIONS
);
