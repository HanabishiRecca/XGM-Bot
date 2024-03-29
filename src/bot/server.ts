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
import { createServer, IncomingMessage, ServerResponse } from "http";

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

    return async (recipient_id: string, content: string) => {
        await Actions.Message.Create(await GetCh(recipient_id), { content });
    };
})();

const SendPMI = (recipient_id: string, content: string) =>
    SendPM(recipient_id, content).catch(Logger.Warn);

const FilterRejection = (e: { code: number }) => {
    if (e.code != 404) throw e;
    return undefined;
};

const GetMember = (id: string) =>
    Actions.Member.Get(config.server, id).catch(FilterRejection);

const GetBan = (id: string) =>
    Actions.Ban.Get(config.server, id).catch(FilterRejection);

const UpdateUserState = async (id: string, xgmid?: number) => {
    try {
        let member = (await GetMember(id)) as MemberPart | undefined;
        let banned = false;

        if (!member) {
            member = { user: await Actions.User.Get(id) };
            banned = Boolean(await GetBan(id));
        }

        await (xgmid
            ? SyncUser(config.server, member, xgmid, banned)
            : ClearUser(config.server, member));
    } catch (e) {
        Logger.Error(e);
    }
};

const UpdateUserRecord = (id: string, xgmid: number) => {
    const exist = AuthUsers.get(id);

    if (exist) {
        if (exist == xgmid) {
            SendPMI(id, "Аккаунт уже подтвержден.");
            return 208;
        }

        AuthUsers.set(id, xgmid);
        SaveAuthUsers();
        SendLogMsg(
            `Перепривязка аккаунта XGM ${Tools.Mention.User(
                id,
            )} :white_check_mark: ${GenXgmUserLink(
                xgmid,
            )}\nСтарый аккаунт был <${GenXgmUserLink(exist)}>`,
        );
        SendPMI(
            id,
            `:white_check_mark: Аккаунт перепривязан!\n${GenXgmUserLink(
                xgmid,
            )}`,
        );

        return 200;
    }

    const prev = FindAuthUser(xgmid);

    if (prev) {
        Logger.Log(`Verify: remove ${prev}`);
        AuthUsers.delete(prev);
        UpdateUserState(prev);
    }

    Logger.Log(`Verify: ${id} -> ${xgmid}`);
    AuthUsers.set(id, xgmid);
    SaveAuthUsers();

    SendLogMsg(
        prev
            ? `Перепривязка аккаунта Discord ${Tools.Mention.User(
                  id,
              )} :white_check_mark: ${GenXgmUserLink(
                  xgmid,
              )}\nСтарый аккаунт был ${Tools.Mention.User(prev)}`
            : `Привязка аккаунта ${Tools.Mention.User(
                  id,
              )} :white_check_mark: ${GenXgmUserLink(xgmid)}`,
    );
    SendPMI(
        id,
        `:white_check_mark: Аккаунт подтвержден!\n${GenXgmUserLink(xgmid)}`,
    );

    return 200;
};

const VerifyUser = async (code: string, xgmid: number) => {
    const auth = await Actions.OAuth2.TokenExchange({
        client_id: config.id,
        client_secret: CLIENT_SECRET,
        grant_type: Helpers.OAuth2GrantTypes.AUTHORIZATION_CODE,
        redirect_uri: REDIRECT_URL,
        scope: Helpers.OAuth2Scopes.IDENTIFY,
        code,
    }).catch(Logger.Warn);

    if (!auth) {
        Logger.Warn("Verify: token request failed.");
        return { code: 400 };
    }

    const user = await Actions.User.Get("@me", {
        authorization: new Authorization(
            auth.access_token,
            Helpers.TokenTypes.BEARER,
        ),
    }).catch(Logger.Error);

    if (!user) {
        Logger.Warn("Verify: user request failed.");
        return { code: 500 };
    }

    if (user.id == config.id) return { code: 418 };

    const result = UpdateUserRecord(user.id, xgmid);
    UpdateUserState(user.id, xgmid);

    return { code: result, content: user.id };
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

const webApiFuncs: {
    [key: string]: (request: IncomingMessage, response: ServerResponse) => void;
} = {
    "/verify": async (request, response) => {
        const code = request.headers["code"];
        const xgmid = Number(request.headers["userid"]);

        if (!(typeof code == "string" && xgmid > 0))
            return (response.statusCode = 400);

        const ret = await VerifyUser(code, xgmid);
        response.statusCode = ret.code;

        if (!ret.content) return;
        response.setHeader("Content-Length", Buffer.byteLength(ret.content));
        response.write(ret.content);
    },

    "/delete": async (request, response) => {
        const xgmid = Number(request.headers["userid"]);
        if (!(xgmid > 0)) return (response.statusCode = 400);

        const id = FindAuthUser(xgmid);
        if (!id) return (response.statusCode = 200);
        if (id == config.id) return (response.statusCode = 418);

        Logger.Log(`Verify: delete! ${id}`);

        AuthUsers.delete(id);
        SaveAuthUsers();
        UpdateUserState(id);

        const data = await ReadIncomingData(request);
        const reason = data ? `**Причина:** ${data}` : "";

        SendLogMsg(
            `Отвязка аккаунта ${Tools.Mention.User(
                id,
            )} :no_entry: ${GenXgmUserLink(xgmid)}\n${reason}`,
        );
        SendPMI(id, `:no_entry: Аккаунт деавторизован.\n${reason}`);

        response.statusCode = 200;
    },

    "/update-global-status": async (request, response) => {
        const xgmid = Number(request.headers["userid"]);
        if (!(xgmid > 0)) return (response.statusCode = 400);

        Logger.Log(`S: ${xgmid} - '${request.headers["status"]}'`);

        const id = FindAuthUser(xgmid);
        if (!id) return (response.statusCode = 200);
        if (id == config.id) return (response.statusCode = 418);

        UpdateUserState(id, xgmid);

        response.statusCode = 200;
    },

    "/pm": async (request, response) => {
        const xgmid = Number(request.headers["userid"]);
        if (!(xgmid > 0)) return (response.statusCode = 400);

        const id = FindAuthUser(xgmid);
        if (!id) return (response.statusCode = 404);
        if (id == config.id) return (response.statusCode = 418);

        const data = await ReadIncomingData(request);
        if (!data) return (response.statusCode = 400);

        response.statusCode = 200;

        await SendPM(id, String(data).substring(0, MESSAGE_MAX_CHARS)).catch(
            (e: { code: number }) => {
                Logger.Warn(e);
                response.statusCode = e.code ?? 500;
            },
        );
    },

    "/send": async (request, response) => {
        const channelid = request.headers["channelid"];
        if (typeof channelid != "string") return (response.statusCode = 400);

        const data = await ReadIncomingData(request);
        if (!data) return (response.statusCode = 400);

        response.statusCode = 200;

        await Actions.Message.Create(channelid, {
            content: String(data).substring(0, MESSAGE_MAX_CHARS),
        }).catch((e: { code: number }) => {
            Logger.Error(e);
            response.statusCode = e.code ?? 500;
        });
    },

    "/sys": async (request, response) => {
        const data = await ReadIncomingData(request);
        if (!data) return (response.statusCode = 400);

        SendSysLogMsg(String(data)).catch(Logger.Error);
        response.statusCode = 200;
    },

    "/pull": async (request, response) => {
        const channelid = request.headers["channelid"];
        const count = Number(request.headers["count"]);

        if (typeof channelid != "string") return (response.statusCode = 400);

        const messages = await Actions.Channel.GetMessages(
            channelid,
            count ? { limit: Math.min(Math.max(count, 1), 100) } : undefined,
        ).catch(({ code }: { code: number }) => code);

        if (!Array.isArray(messages))
            return (response.statusCode = Number(messages) ?? 500);

        messages.forEach(ResolveMessage);
        response.statusCode = 200;

        const data = JSON.stringify(messages);
        response.setHeader("Content-Length", Buffer.byteLength(data));
        response.write(data);
    },
};

const HandleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
) => {
    const { method, headers, url } = request;

    Logger.Log(`${method} '${url}'`);

    if (method != "POST") return (response.statusCode = 405);

    if (headers["authorization"] != AUTH_SVC)
        return (response.statusCode = 401);

    if (!(url && webApiFuncs.hasOwnProperty(url)))
        return (response.statusCode = 404);

    if (Number(headers["content-length"]) > MAX_PAYLOAD)
        return (response.statusCode = 413);

    await webApiFuncs[url]?.(request, response);
};

createServer(async (request, response) => {
    await HandleRequest(request, response).catch((e) => {
        Logger.Error(e);
        response.statusCode = 500;
    });
    response.end();
    Logger.Log(`Response end. Code: ${response.statusCode}`);
}).listen(Number(SVC_PORT));
