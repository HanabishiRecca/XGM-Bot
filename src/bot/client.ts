import Logger from '../util/log.js';
import { SyncUser, ClearUser, MemberPart } from '../util/users.js';
import { Shutdown } from './process.js';
import { config, AuthUsers, SendLogMsg, authorization } from './state.js';
import { SetMarks, ReactionProc } from './marks.js';
import { RegisterCommands, HandleInteraction } from './commands.js';
import { Client, ClientEvents, Events, Helpers, Tools } from 'discord-slim';

const client = new Client();

client.on(ClientEvents.CONNECT, () => Logger.Log('Connection established.'));
client.on(ClientEvents.DISCONNECT, (code) => Logger.Error(`Disconnect. (${code})`));
client.on(ClientEvents.WARN, Logger.Warn);
client.on(ClientEvents.ERROR, Logger.Error);
client.on(ClientEvents.FATAL, Shutdown);

const IsServer = (id?: string) => id == config.server;

const CheckUser = (member: MemberPart, banned: boolean) => {
    if(member.user.bot) return;
    const xgmid = AuthUsers.get(member.user.id);
    (xgmid ?
        SyncUser(config.server, member, xgmid, banned) :
        ClearUser(config.server, member)
    ).catch(Logger.Error);
};

client.events.on(Events.READY, ({ user: { id } }) => {
    Logger.Log('READY');
    RegisterCommands(id);
});

client.events.on(Events.INTERACTION_CREATE, HandleInteraction);

client.events.on(Events.GUILD_MEMBER_ADD, async (member) => {
    if(!IsServer(member.guild_id)) return;
    SendLogMsg(`<:zplus:544205514943365123> ${Tools.Mention.User(member.user)} присоединился к серверу.`);
    CheckUser(member, false);
});

client.events.on(Events.GUILD_MEMBER_UPDATE, (member) =>
    IsServer(member.guild_id) &&
    CheckUser(member, false));

client.events.on(Events.GUILD_MEMBER_REMOVE, ({ guild_id, user }) =>
    IsServer(guild_id) &&
    SendLogMsg(`<:zminus:544205486073839616> ${Tools.Mention.User(user)} покинул сервер.`));

client.events.on(Events.MESSAGE_REACTION_ADD, (reaction) =>
    IsServer(reaction.guild_id) &&
    ReactionProc(reaction, true));

client.events.on(Events.MESSAGE_REACTION_REMOVE, (reaction) =>
    IsServer(reaction.guild_id) &&
    ReactionProc(reaction, false));

client.events.on(Events.GUILD_CREATE, ({ id, emojis }) =>
    IsServer(id) &&
    SetMarks(emojis));

client.events.on(Events.GUILD_BAN_ADD, ({ guild_id, user }) =>
    IsServer(guild_id) &&
    CheckUser({ user }, true));

client.events.on(Events.GUILD_BAN_REMOVE, ({ guild_id, user }) =>
    IsServer(guild_id) &&
    CheckUser({ user }, false));

client.Connect(authorization, Helpers.Intents.SYSTEM
    | Helpers.Intents.GUILDS
    | Helpers.Intents.GUILD_MEMBERS
    | Helpers.Intents.GUILD_BANS
    | Helpers.Intents.GUILD_MESSAGE_REACTIONS
);
