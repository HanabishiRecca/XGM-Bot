import Logger from "./log";
import { LoadConfig } from "./config";
import { HttpsGet } from "./request";
import { Actions, Types } from "discord-slim";

const config = LoadConfig("users");

export const GenXgmUserLink = (xgmid: number) =>
    `https://xgm.guru/user/${xgmid}`;

export type MemberPart = Pick<Types.Member, "user"> &
    Partial<Pick<Types.Member, "roles" | "nick">>;

const projectStatuses = ["leader", "moderator", "active", "guest"];

const IsInProject = (status?: string | null) =>
    status ? projectStatuses.includes(status) : false;

const DiffRoles = (roles: string[], flags?: boolean[]) => {
    const rs = new Set<string>();
    for (const role of roles) rs.add(role);

    let index = 0;
    let check = true;

    for (const role of config.roles) {
        const flag = Boolean(flags?.[index++]);
        if (rs.has(role) == flag) continue;
        flag ? rs.add(role) : rs.delete(role);
        check = false;
    }

    if (check) return;
    return Array.from(rs);
};

const ModifyUser = async (
    server: string,
    id: string,
    roles?: string[],
    nick?: string | null,
) => {
    if (!roles && nick === undefined) return;
    await Actions.Member.Modify(server, id, { roles, nick }).catch(() =>
        Logger.Warn(`Can't modify ${id}.`),
    );
};

type XgmUser = {
    info: {
        avatar: {
            exits: number;
            small: string;
            big: string;
            datetime: string | 0;
        };
        user: {
            id: string;
            username: string;
            level: number;
            level_xp: string;
            last_activity: null;
            loggedin: number;
            activity: string;
            fields: {
                location: string;
                skype: string;
                vk: string;
                discord: string;
            };
            abilities_achievements: null;
            seeTwilight: boolean;
        };
        url: {
            profile: string;
        };
    };
    state: {
        access: {
            staff_member: boolean;
            staff_status: string | null;
            statuses_available: number[];
        };
        projects: {
            [key: string]: {
                id: string;
                status: string;
                title: string | null;
                level: string | null;
                active: string | null;
            };
        };
    };
    timeElapsedSec: number;
};

export const RequestXgmUser = async (xgmid: number) => {
    const data = await HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`);
    if (!data) throw "Empty user response!";
    return JSON.parse(String(data)) as XgmUser;
};

const DoSync = async (
    { info, state }: XgmUser,
    server: string,
    { user: { id }, roles, nick }: MemberPart,
    banned: boolean,
) => {
    if (!(info && state)) {
        Logger.Warn("User not exists!");
        if (!roles) return;
        await ModifyUser(server, id, DiffRoles(roles), nick ? null : undefined);
        return;
    }

    const {
        user: { username, seeTwilight },
    } = info;
    const {
        access: { staff_status },
        projects,
    } = state;

    if (staff_status == "suspended") {
        banned || (await Actions.Ban.Add(server, id));
        return;
    }

    if (banned) {
        await Actions.Ban.Remove(server, id);
        return;
    }

    if (!roles) return;
    await ModifyUser(
        server,
        id,
        DiffRoles(roles, [
            staff_status == "readonly",
            true,
            IsInProject(staff_status),
            IsInProject(projects["833"]?.status),
            seeTwilight,
        ]),
        nick == username ? undefined : username,
    );
};

const syncLock = new Set<string>();

export const SyncUser = async (
    server: string,
    member: MemberPart,
    xgmid: number,
    banned: boolean,
    prefetched?: XgmUser,
) => {
    const {
        user: { id, bot },
    } = member;
    if (bot) return;

    if (syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await DoSync(
            prefetched ?? (await RequestXgmUser(xgmid)),
            server,
            member,
            banned,
        );
    } catch (e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};

export const ClearUser = async (server: string, member: MemberPart) => {
    const {
        user: { id, bot },
        roles,
        nick,
    } = member;
    if (bot || !roles) return;

    if (syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await ModifyUser(server, id, DiffRoles(roles), nick ? null : undefined);
    } catch (e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};
