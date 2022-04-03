import Logger from './log.js';
import config from './config.js';
import { HttpsGet } from './request.js';
import { Actions, Types } from 'discord-slim';

export const
    GenXgmUserLink = (xgmid: number) => `https://xgm.guru/user/${xgmid}`,
    GetUserCreationDate = (user_id: string) => Number(BigInt(user_id) >> 22n) + 1420070400000;

export type MemberPart = Pick<Types.Member, 'user'> & Partial<Pick<Types.Member, 'roles' | 'nick'>>;

const IsInProject = (status?: string | null) =>
    Boolean(status) && ((status == 'active') || (status == 'moderator') || (status == 'leader'));

const SetRole = async ({ user: { id }, roles }: MemberPart, role: string, enable: boolean) => {
    if(!roles) return;
    roles.includes(role) ?
        enable || await Actions.Member.RemoveRole(config.server, id, role) :
        enable && await Actions.Member.AddRole(config.server, id, role);
};

const SetRoles = async (member: MemberPart, flags?: boolean[]) => {
    let index = 0;
    for(const role of config.roles)
        await SetRole(member, role, flags?.[index++] ?? false);
};

const SetNick = (id: string, nick: string | null) =>
    Actions.Member.Modify(config.server, id, { nick }).
        catch(() => Logger.Warn(`Can't change a nickname for ${id}.`));

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
            } | undefined;
        };
    };
    timeElapsedSec: number;
};

export const RequestXgmUser = async (xgmid: number) => {
    const data = await HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`);
    if(!data) throw 'Empty user response!';
    return JSON.parse(String(data)) as XgmUser;
};

const DoSync = async (member: MemberPart, xgmid: number, banned: boolean) => {
    const {
        info: {
            user: {
                username: xgmname,
                seeTwilight,
            },
        },
        state: {
            access: {
                staff_status,
            },
            projects,
        },
    } = await RequestXgmUser(xgmid);

    const { user: { id, username }, roles, nick } = member;

    if(staff_status == 'suspended') {
        banned || await Actions.Ban.Add(config.server, id);
        return;
    }

    if(banned) {
        await Actions.Ban.Remove(config.server, id);
        return;
    }

    if(!roles) return;
    await SetRoles(member, [
        staff_status == 'readonly',
        true,
        IsInProject(staff_status),
        IsInProject(projects['833']?.status),
        seeTwilight,
    ]);

    if((nick == xgmname) && (username == xgmname)) return;
    await SetNick(id, xgmname);
};

const syncLock = new Set<string>();

export const SyncUser = async (member: MemberPart, xgmid: number, banned: boolean) => {
    const { user: { id } } = member;
    if(syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await DoSync(member, xgmid, banned);
    } catch(e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};

export const ClearUser = async (member: MemberPart) => {
    const { user: { id }, roles } = member;
    if(!roles) return;

    if(syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await SetRoles(member);
        member.nick && await SetNick(id, null);
    } catch(e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};
