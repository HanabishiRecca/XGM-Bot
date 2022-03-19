import config from './config.js';
import { HttpsGet } from './request.js';
import { Actions, Types } from 'discord-slim';

const HasRole = (member: Types.Member, role_id: string) =>
    member.roles.indexOf(role_id) > -1;

const IsInProject = (status?: string | null) =>
    Boolean(status && ((status == 'leader') || (status == 'moderator') || (status == 'active')));

const RoleSwitch = async (member: Types.Member, role: string, enable: boolean) => {
    if(!(member.user && role)) return;

    const f = enable ?
        (HasRole(member, role) ? null : Actions.Member.AddRole) :
        (HasRole(member, role) ? Actions.Member.RemoveRole : null);

    await f?.(config.server, member.user.id, role);
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

export const SyncUser = async (id: string, xgmid: number, banned: boolean, member?: Types.Member) => {
    if(member?.user?.bot) return;

    const
        { info, state } = await RequestXgmUser(xgmid),
        status = state.access.staff_status;

    if(status == 'suspended') {
        if(!banned)
            await Actions.Ban.Add(config.server, id);
        return;
    }

    if(banned)
        await Actions.Ban.Remove(config.server, id);

    if(!member) return;

    await RoleSwitch(member, config.role.readonly, status == 'readonly');
    await RoleSwitch(member, config.role.user, true);
    await RoleSwitch(member, config.role.staff, IsInProject(status));
    await RoleSwitch(member, config.role.team, IsInProject(state.projects['833']?.status));
    await RoleSwitch(member, config.role.twilight, info.user.seeTwilight);
};

export const ClearUser = async (member: Types.Member) => {
    await RoleSwitch(member, config.role.readonly, false);
    await RoleSwitch(member, config.role.user, false);
    await RoleSwitch(member, config.role.staff, false);
    await RoleSwitch(member, config.role.team, false);
    await RoleSwitch(member, config.role.twilight, false);
};
