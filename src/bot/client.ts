import Logger from "../util/log";
import { SyncUser, ClearUser, MemberPart } from "../util/users";
import { Shutdown, STORAGE } from "./process";
import { config, AuthUsers, SendLogMsg, authorization } from "./state";
import { SetMarks, ReactionProc } from "./marks";
import { RegisterCommands, HandleInteraction } from "./commands";
import { readFileSync, writeFileSync, rmSync } from "fs";
import { Client, ClientEvents, Events, Helpers, Tools } from "discord-slim";

const INTENTS =
    Helpers.Intents.SYSTEM |
    Helpers.Intents.GUILDS |
    Helpers.Intents.GUILD_MEMBERS |
    Helpers.Intents.GUILD_BANS |
    Helpers.Intents.GUILD_MESSAGE_REACTIONS;

const SESSION_FILE = `${STORAGE}/session`;
const client = new Client();
let resumable = true;

client.on(ClientEvents.CONNECT, () => {
    Logger.Debug("Connection established.");

    const { session } = client;
    if (!session) {
        Logger.Warn("Unknown session.");
        return;
    }

    const { id, seq } = session;
    Logger.Debug("Session:", id, seq);
});

client.on(ClientEvents.DISCONNECT, (code) =>
    Logger.Debug(`Disconnect. (${code})`),
);

client.on(ClientEvents.INFO, Logger.Info);
client.on(ClientEvents.WARN, (data) => {
    if (data.startsWith("Invalid session.")) {
        resumable = false;
        Shutdown(data);
    }

    data == "Server forced reconnect." ? Logger.Debug(data) : Logger.Warn(data);
});
client.on(ClientEvents.ERROR, Logger.Error);
client.on(ClientEvents.FATAL, Shutdown);

client.on(ClientEvents.INTENT, ({ t, d }) => {
    if (t == "READY") {
        Logger.Debug(`Ready guilds: ${d.guilds.length}`);
    }
});

process.on("exit", () => {
    if (!resumable) return;
    const { session } = client;
    if (!session) return;
    const { id, seq } = session;
    writeFileSync(SESSION_FILE, `${id}\n${seq}`, {
        encoding: "utf8",
    });
});

process.on("SIGTERM", (e) => Shutdown(e, true));
process.on("SIGINT", (e) => Shutdown(e, true));
process.on("SIGHUP", (e) => Shutdown(e, true));

const LoadSession = () => {
    let content: string;

    try {
        content = readFileSync(SESSION_FILE, { encoding: "utf8" });
    } catch {
        Logger.Debug("Session file not found.");
        return;
    }

    rmSync(SESSION_FILE, { force: true });

    const [id, seqs] = content.split("\n");
    if (!(id && seqs)) return;

    const seq = Number(seqs);
    if (!(seq > 0)) return;

    Logger.Debug("Session loaded:", id, seq);
    return { id, seq };
};

const IsServer = (id?: string) => id == config.server;

const CheckUser = (member: MemberPart, banned: boolean) => {
    if (member.user.bot) return;
    const xgmid = AuthUsers.get(member.user.id);
    (xgmid
        ? SyncUser(config.server, member, xgmid, banned)
        : ClearUser(config.server, member)
    ).catch(Logger.Error);
};

client.events.on(Events.INTERACTION_CREATE, HandleInteraction);

client.events.on(Events.GUILD_MEMBER_ADD, (member) => {
    const { guild_id, user } = member;
    Logger.Info("GUILD", guild_id, "MEMBER ADD", user.id);
    if (!IsServer(guild_id)) return;
    SendLogMsg(
        `<:zplus:544205514943365123> ${Tools.Mention.User(
            user,
        )} присоединился к серверу.`,
    );
    CheckUser(member, false);
});

client.events.on(
    Events.GUILD_MEMBER_UPDATE,
    (member) => IsServer(member.guild_id) && CheckUser(member, false),
);

client.events.on(Events.GUILD_MEMBER_REMOVE, ({ guild_id, user }) => {
    Logger.Info("GUILD", guild_id, "MEMBER REMOVE", user.id);
    if (!IsServer(guild_id)) return;
    SendLogMsg(
        `<:zminus:544205486073839616> ${Tools.Mention.User(
            user,
        )} покинул сервер.`,
    );
});

client.events.on(
    Events.MESSAGE_REACTION_ADD,
    (reaction) => IsServer(reaction.guild_id) && ReactionProc(reaction, true),
);

client.events.on(
    Events.MESSAGE_REACTION_REMOVE,
    (reaction) => IsServer(reaction.guild_id) && ReactionProc(reaction, false),
);

client.events.on(Events.GUILD_CREATE, ({ id, emojis }) => {
    Logger.Info("GUILD CREATE", id);
    if (!IsServer(id)) return;
    RegisterCommands(config.id);
    SetMarks(emojis);
});

client.events.on(Events.GUILD_BAN_ADD, ({ guild_id, user }) => {
    Logger.Info("GUILD", guild_id, "BAN ADD", user.id);
    if (!IsServer(guild_id)) return;
    CheckUser({ user }, true);
});

client.events.on(Events.GUILD_BAN_REMOVE, ({ guild_id, user }) => {
    Logger.Info("GUILD", guild_id, "BAN REMOVE", user.id);
    if (!IsServer(guild_id)) return;
    CheckUser({ user }, false);
});

(() => {
    const session = LoadSession();
    session
        ? client.Resume(authorization, session)
        : client.Connect(authorization, INTENTS);
})();
