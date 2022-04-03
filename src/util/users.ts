import Logger from './log.js';
import config from './config.js';
import { HttpsGet } from './request.js';
import { Actions, Types } from 'discord-slim';

export const
    GenXgmUserLink = (xgmid: number) => `https://xgm.guru/user/${xgmid}`,
    GetUserCreationDate = (user_id: string) => Number(BigInt(user_id) >> 22n) + 1420070400000;

const HasRole = ({ roles }: Pick<Types.Member, 'roles'>, id: string) =>
    roles.indexOf(id) > -1;

const IsInProject = (status?: string | null) =>
    Boolean(status) && ((status == 'active') || (status == 'moderator') || (status == 'leader'));

const RoleSwitch = async (member: Pick<Types.Member, 'user' | 'roles'>, role: string, enable: boolean) => {
    const f = enable ?
        (HasRole(member, role) ? null : Actions.Member.AddRole) :
        (HasRole(member, role) ? Actions.Member.RemoveRole : null);

    await f?.(config.server, member.user.id, role);
};

const SetNick = ({ id, username, discriminator }: Types.User, nick: string | null) =>
    Actions.Member.Modify(config.server, id, { nick }).
        catch(() => Logger.Warn(`Can't change a nickname for ${username}#${discriminator}`));

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

type MemberPart = Pick<Types.Member, 'user' | 'roles' | 'nick'>;

export const RequestXgmUser = async (xgmid: number) => {
    const data = await HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`);
    if(!data) throw 'Empty user response!';
    return JSON.parse(String(data)) as XgmUser;
};

const DoSync = async (id: string, xgmid: number, banned: boolean, member?: MemberPart) => {
    const {
        info: {
            user: {
                username,
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

    if(staff_status == 'suspended') {
        if(!banned)
            await Actions.Ban.Add(config.server, id);
        return;
    }

    if(banned)
        await Actions.Ban.Remove(config.server, id);

    if(!member) return;
    const { user } = member;
    if(!user) return;

    await RoleSwitch(member, config.role.readonly, staff_status == 'readonly');
    await RoleSwitch(member, config.role.user, true);
    await RoleSwitch(member, config.role.staff, IsInProject(staff_status));
    await RoleSwitch(member, config.role.team, IsInProject(projects['833']?.status));
    await RoleSwitch(member, config.role.twilight, seeTwilight);

    if(member.nick) {
        if(member.nick == username) return;
    } else {
        if(user.username == username) return;
    }

    await SetNick(user, username);
};

const syncLock = new Set<string>();

export const SyncUser = async (id: string, xgmid: number, banned: boolean, member?: MemberPart) => {
    if(member?.user.bot) return;

    if(syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await DoSync(id, xgmid, banned, member);
    } catch(e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};

export const ClearUser = async (member?: MemberPart) => {
    if(!member) return;

    const { user } = member;
    if(user.bot) return;

    const { id } = user;
    if(syncLock.has(id)) return;
    syncLock.add(id);

    try {
        await RoleSwitch(member, config.role.readonly, false);
        await RoleSwitch(member, config.role.user, false);
        await RoleSwitch(member, config.role.staff, false);
        await RoleSwitch(member, config.role.team, false);
        await RoleSwitch(member, config.role.twilight, false);

        if(member.nick)
            await SetNick(user, null);
    } catch(e) {
        throw e;
    } finally {
        syncLock.delete(id);
    }
};
