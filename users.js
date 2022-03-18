'use strict';

import config from './config.js';
import { HttpsGet } from './misc.js';
import { Actions } from 'discord-slim';

const
    HasRole = (member, role_id) => member.roles.indexOf(role_id) > -1,
    IsInProject = (status) => status && ((status == 'leader') || (status == 'moderator') || (status == 'active'));

const RoleSwitch = async (member, role, enable) => {
    if(!(member && role)) return;

    const f = enable ?
        (HasRole(member, role) ? null : Actions.Member.AddRole) :
        (HasRole(member, role) ? Actions.Member.RemoveRole : null);

    await f?.(config.server, member.user.id, role);
};

export const RequestXgmUser = async (xgmid) => {
    let data;
    try {
        data = await HttpsGet(`https://xgm.guru/api_user.php?id=${xgmid}`);
    } catch(e) {
        if(e.statusCode == 404) return {};
        throw e;
    }
    return JSON.parse(data);
};

export const SyncUser = async (id, xgmid, banned, member) => {
    if(member?.user.bot) return;

    const { info, state } = await RequestXgmUser(xgmid);
    if(!(info && state)) return;

    const status = state.access?.staff_status;

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
    await RoleSwitch(member, config.role.team, IsInProject(state.projects?.['833']?.status));
    await RoleSwitch(member, config.role.twilight, info.user?.seeTwilight);
};

export const ClearUser = async (member) => {
    await RoleSwitch(member, config.role.readonly, false);
    await RoleSwitch(member, config.role.user, false);
    await RoleSwitch(member, config.role.staff, false);
    await RoleSwitch(member, config.role.team, false);
    await RoleSwitch(member, config.role.twilight, false);
};
