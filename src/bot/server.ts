import Logger from "../util/log";
import { SyncUser, ClearUser, GenXgmUserLink, MemberPart } from "../util/users";
import { ReadIncomingData } from "../util/request";
import {
    AUTH_SVC,
    CLIENT_SECRET,
    REDIRECT_URL,
    SVC_PORT,
    WH_SYSLOG_ID,
    WH_SYSLOG_TOKEN,
} from "./process";
import {
    config,
    AuthUsers,
    SaveAuthUsers,
    FindAuthUser,
    SendLogMsg,
} from "./state";
import { Authorization, Actions, Helpers, Tools, Types } from "discord-slim";
import { createServer, IncomingMessage } from "http";

const MAX_PAYLOAD = 8192;
const MESSAGE_MAX_CHARS = 2000;

const SendPM = (() => {
    const cache = new Map<string, string>();

    const GetCh = async (recipient_id: string) => {
        const cache_id = cache.get(recipient_id);
        if (cache_id) return cache_id;

        const { id } = await Actions.DM.Create({ recipient_id });
        cache.set(recipient_id, id);
        return id;
    };

    return async (recipient_id: string, content: string) =>
        Actions.Message.Create(await GetCh(recipient_id), { content });
})();

const SendPMI = (recipient_id: string, content: string) =>
    SendPM(recipient_id, content).catch(Logger.Warn);

const CheckError = (e: unknown): e is { code: number } =>
    e instanceof Object && "code" in e && typeof e.code == "number";

const FilterRejection = (e: unknown) => {
    if (CheckError(e) && e.code != 404) throw e;
};

const GetMember = (id: string): Promise<MemberPart | void> =>
    Actions.Member.Get(config.server, id).catch(FilterRejection);

const GetBan = (id: string) =>
    Actions.Ban.Get(config.server, id).catch(FilterRejection);

const UpdateUserState = async (id: string, xgmid?: number) => {
    let member = await GetMember(id);
    let banned = false;

    if (!member) {
        member = { user: await Actions.User.Get(id) };
        banned = (await GetBan(id)) != null;
    }

    xgmid
        ? SyncUser(config.server, member, xgmid, banned)
        : ClearUser(config.server, member);
};

const UpdateUserStateI = (id: string, xgmid?: number) =>
    UpdateUserState(id, xgmid).catch(Logger.Error);

const UpdateUserRecord = (id: string, xgmid: number) => {
    const exist = AuthUsers.get(id);

    if (exist) {
        if (exist == xgmid) {
            SendPMI(id, "Аккаунт уже подтвержден.");
            return 208;
        }

        AuthUsers.set(id, xgmid);
        SaveAuthUsers();

        const link = GenXgmUserLink(xgmid);
        SendLogMsg(`\
Перепривязка аккаунта XGM ${Tools.Mention.User(id)} :white_check_mark:
${link}
Старый аккаунт был <${GenXgmUserLink(exist)}>
`);
        SendPMI(
            id,
            `\
:white_check_mark: Аккаунт перепривязан!
${link}
`,
        );

        return 200;
    }

    const prev = FindAuthUser(xgmid);

    if (prev) {
        Logger.Log(`Verify: remove ${prev}`);
        AuthUsers.delete(prev);
        UpdateUserStateI(prev);
    }

    Logger.Log(`Verify: ${id} -> ${xgmid}`);
    AuthUsers.set(id, xgmid);
    SaveAuthUsers();

    const link = GenXgmUserLink(xgmid);
    SendLogMsg(
        prev
            ? `\
Перепривязка аккаунта Discord ${Tools.Mention.User(id)} :white_check_mark:
Старый аккаунт был ${Tools.Mention.User(prev)}
${link}
`
            : `\
Привязка аккаунта ${Tools.Mention.User(id)} :white_check_mark:
${link}
`,
    );

    SendPMI(
        id,
        `\
:white_check_mark: Аккаунт подтвержден!
${link}
`,
    );

    return 200;
};

const SendSysLogMsg = async (content: string) => {
    for (let i = 0; i < content.length; i += MESSAGE_MAX_CHARS)
        await Actions.Webhook.Execute(WH_SYSLOG_ID, WH_SYSLOG_TOKEN, {
            content: content.substring(i, i + MESSAGE_MAX_CHARS),
        });
};

const AttachXgmId = (user: Types.User & { xgmId?: number }) =>
    (user.xgmId = AuthUsers.get(user.id));

const ResolveMessage = ({
    author,
    mentions,
    referenced_message,
}: Types.Message) => {
    AttachXgmId(author);
    mentions?.forEach(AttachXgmId);
    referenced_message && ResolveMessage(referenced_message);
};

type EndpointResult = { code: number; content?: string };
type Endpoint = (request: IncomingMessage) => Promise<EndpointResult>;
const endpoints = new Map<string, Endpoint>();

endpoints.set("/verify", async (request) => {
    const code = request.headers["code"];
    const xgmid = Number(request.headers["userid"]);
    if (!(typeof code == "string" && xgmid > 0)) return { code: 400 };

    const auth = await Actions.OAuth2.TokenExchange({
        client_id: config.id,
        client_secret: CLIENT_SECRET,
        grant_type: Helpers.OAuth2GrantTypes.AUTHORIZATION_CODE,
        redirect_uri: REDIRECT_URL,
        scope: Helpers.OAuth2Scopes.IDENTIFY,
        code,
    });

    const user = await Actions.User.Get("@me", {
        authorization: new Authorization(
            auth.access_token,
            Helpers.TokenTypes.BEARER,
        ),
    });

    if (user.id == config.id) return { code: 418 };

    const result = UpdateUserRecord(user.id, xgmid);
    UpdateUserStateI(user.id, xgmid);

    return { code: result, content: user.id };
});

endpoints.set("/delete", async (request) => {
    const xgmid = Number(request.headers["userid"]);
    if (!(xgmid > 0)) return { code: 400 };

    const id = FindAuthUser(xgmid);
    if (!id) return { code: 200 };
    if (id == config.id) return { code: 418 };

    Logger.Log(`Verify: delete! ${id}`);

    AuthUsers.delete(id);
    SaveAuthUsers();
    UpdateUserStateI(id);

    const data = await ReadIncomingData(request);
    const reason = data ? `**Причина:** ${data}` : "";

    SendLogMsg(`\
Отвязка аккаунта ${Tools.Mention.User(id)} :no_entry:
${GenXgmUserLink(xgmid)}
${reason}
`);
    SendPMI(
        id,
        `\
:no_entry: Аккаунт деавторизован.
${reason}
`,
    );

    return { code: 200 };
});

endpoints.set("/update-global-status", async (request) => {
    const xgmid = Number(request.headers["userid"]);
    if (!(xgmid > 0)) return { code: 400 };

    Logger.Log(`S: ${xgmid} - '${request.headers["status"]}'`);

    const id = FindAuthUser(xgmid);
    if (!id) return { code: 200 };
    if (id == config.id) return { code: 418 };

    UpdateUserStateI(id, xgmid);

    return { code: 200 };
});

endpoints.set("/pm", async (request) => {
    const xgmid = Number(request.headers["userid"]);
    if (!(xgmid > 0)) return { code: 400 };

    const id = FindAuthUser(xgmid);
    if (!id) return { code: 404 };
    if (id == config.id) return { code: 418 };

    const data = await ReadIncomingData(request);
    if (!data) return { code: 400 };

    await SendPM(id, String(data).substring(0, MESSAGE_MAX_CHARS));

    return { code: 200 };
});

endpoints.set("/send", async (request) => {
    const channelid = request.headers["channelid"];
    if (typeof channelid != "string") return { code: 400 };

    const data = await ReadIncomingData(request);
    if (!data) return { code: 400 };

    await Actions.Message.Create(channelid, {
        content: String(data).substring(0, MESSAGE_MAX_CHARS),
    });

    return { code: 200 };
});

endpoints.set("/sys", async (request) => {
    const data = await ReadIncomingData(request);
    if (!data) return { code: 400 };

    SendSysLogMsg(String(data)).catch(Logger.Error);

    return { code: 200 };
});

endpoints.set("/pull", async (request) => {
    const channelid = request.headers["channelid"];
    const count = Number(request.headers["count"]);
    if (typeof channelid != "string") return { code: 400 };

    const messages = await Actions.Channel.GetMessages(
        channelid,
        count ? { limit: Math.min(Math.max(count, 1), 100) } : undefined,
    );
    messages.forEach(ResolveMessage);

    return { code: 200, content: JSON.stringify(messages) };
});

const HandleRequest = async (
    request: IncomingMessage,
): Promise<EndpointResult> => {
    const { method, headers, url } = request;
    if (method != "POST") return { code: 405 };
    if (headers["authorization"] != AUTH_SVC) return { code: 401 };
    if (Number(headers["content-length"]) > MAX_PAYLOAD) return { code: 413 };
    if (!url) return { code: 400 };
    return endpoints.get(url)?.(request) ?? { code: 404 };
};

const OnError = (e: unknown): EndpointResult => {
    Logger.Error(e);
    return CheckError(e) ? e : { code: 500 };
};

createServer(async (request, response) => {
    const { code, content } = await HandleRequest(request).catch(OnError);
    response.statusCode = code;

    if (code != 200) {
        Logger.Log(`${code} ${request.method} '${request.url}'`);
    }

    if (content) {
        response.setHeader("Content-Length", Buffer.byteLength(content));
        response.write(content);
    }

    response.end();
}).listen(Number(SVC_PORT));
