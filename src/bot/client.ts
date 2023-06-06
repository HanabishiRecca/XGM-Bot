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

client.on(ClientEvents.CONNECT, () => Logger.Log("Connection established."));
client.on(ClientEvents.DISCONNECT, (code) =>
    Logger.Error(`Disconnect. (${code})`),
);
client.on(ClientEvents.INFO, Logger.Log);
client.on(ClientEvents.WARN, Logger.Warn);
client.on(ClientEvents.ERROR, Logger.Error);
client.on(ClientEvents.FATAL, Shutdown);

process.on("exit", () => {
    const { session } = client;
    if (!session) return;
    writeFileSync(SESSION_FILE, `${session.id}\n${session.seq}`, {
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
        Logger.Warn("Session file not found.");
        return;
    }

    const [id, seqs] = content.split("\n");
    if (!(id && seqs)) return;

    const seq = Number(seqs);
    if (!(seq > 0)) return;

    Logger.Log("Session:", id);
    Logger.Log("Sequence:", seq);

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

client.events.on(Events.GUILD_MEMBER_ADD, async (member) => {
    if (!IsServer(member.guild_id)) return;
    SendLogMsg(
        `<:zplus:544205514943365123> ${Tools.Mention.User(
            member.user,
        )} присоединился к серверу.`,
    );
    CheckUser(member, false);
});

client.events.on(
    Events.GUILD_MEMBER_UPDATE,
    (member) => IsServer(member.guild_id) && CheckUser(member, false),
);

client.events.on(
    Events.GUILD_MEMBER_REMOVE,
    ({ guild_id, user }) =>
        IsServer(guild_id) &&
        SendLogMsg(
            `<:zminus:544205486073839616> ${Tools.Mention.User(
                user,
            )} покинул сервер.`,
        ),
);

client.events.on(
    Events.MESSAGE_REACTION_ADD,
    (reaction) => IsServer(reaction.guild_id) && ReactionProc(reaction, true),
);

client.events.on(
    Events.MESSAGE_REACTION_REMOVE,
    (reaction) => IsServer(reaction.guild_id) && ReactionProc(reaction, false),
);

client.events.on(Events.GUILD_CREATE, ({ id, emojis }) => {
    if (!IsServer(id)) return;
    RegisterCommands(config.id);
    SetMarks(emojis);
});

client.events.on(
    Events.GUILD_BAN_ADD,
    ({ guild_id, user }) => IsServer(guild_id) && CheckUser({ user }, true),
);

client.events.on(
    Events.GUILD_BAN_REMOVE,
    ({ guild_id, user }) => IsServer(guild_id) && CheckUser({ user }, false),
);

(() => {
    const session = LoadSession();
    rmSync(SESSION_FILE, { force: true });

    session
        ? client.Resume(authorization, session)
        : client.Connect(authorization, INTENTS);
})();
