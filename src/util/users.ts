import Logger from './log.js';
import { LoadConfig } from './config.js';
import { HttpsGet } from './request.js';
import { Actions, Types } from 'discord-slim';

const config = LoadConfig('users');

export const GenXgmUserLink = (xgmid: number) => `https://xgm.guru/user/${xgmid}`;

export type MemberPart = Pick<Types.Member, 'user'> & Partial<Pick<Types.Member, 'roles' | 'nick'>>;

const IsInProject = (status?: string | null) =>
    Boolean(status) && ((status == 'active') || (status == 'moderator') || (status == 'leader'));

const SetRole = async (server: string, { user: { id }, roles }: MemberPart, role: string, enable: boolean) => {
    if(!roles) return;
    roles.includes(role) ?
        enable || await Actions.Member.RemoveRole(server, id, role) :
        enable && await Actions.Member.AddRole(server, id, role);
};

const SetRoles = async (server: string, member: MemberPart, flags?: boolean[]) => {
    let index = 0;
    for(const role of config.roles)
        await SetRole(server, member, role, flags?.[index++] ?? false);
};

const SetNick = (server: string, id: string, nick: string | null) =>
    Actions.Member.Modify(server, id, { nick }).
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
            };
        };
    };
    timeElapsedSec: number;
};

export const RequestXgmUser = async (xgmid: number) => {
    const data = await HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`);
    if(!data) throw 'Empty user response!';
    return JSON.parse(String(data)) as XgmUser;
};

const DoSync = async ({ info, state }: XgmUser, server: string, member: MemberPart, banned: boolean) => {
    if(!(info && state)) {
        Logger.Warn('User not exists!');
        await DoClean(server, member);
        return;
    }

    const
        { user: { username: xgmname, seeTwilight } } = info,
        { access: { staff_status }, projects, } = state,
        { user: { id, username }, roles, nick } = member;

    if(staff_status == 'suspended') {
        banned || await Actions.Ban.Add(server, id);
        return;
    }

    if(banned) {
        await Actions.Ban.Remove(server, id);
        return;
    }

    if(!roles) return;
    await SetRoles(server, member, [
        staff_status == 'readonly',
        true,
        IsInProject(staff_status),
        IsInProject(projects['833']?.status),
        seeTwilight,
    ]);

    if((nick ?? username) == xgmname) return;
    await SetNick(server, id, xgmname);
};

const syncLock = new Set<string>();

export const SyncUser = async (server: string, member: MemberPart, xgmid: number, banned: boolean, prefetched?: XgmUser) => {
    const { user: { id, bot } } = member;
    if(bot) return;

    if(syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await DoSync(prefetched ?? await RequestXgmUser(xgmid), server, member, banned);
    } catch(e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};

const DoClean = async (server: string, member: MemberPart) => {
    await SetRoles(server, member);
    if(!member.nick) return;
    await SetNick(server, member.user.id, null);
};

export const ClearUser = async (server: string, member: MemberPart) => {
    const { user: { id, bot }, roles } = member;
    if(bot || !roles) return;

    if(syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await DoClean(server, member);
    } catch(e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};
