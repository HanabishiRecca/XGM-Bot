'use strict';

import Logger from '../util/log.js';
import config from '../util/config.js';
import { RequestXgmUser } from '../util/users.js';
import { GenXgmUserLink, GetUserCreationDate } from '../util/misc.js';
import { AuthUsers } from './state.js';
import { Actions, Helpers, Tools } from 'discord-slim';

const
    EMBED_MESSAGE_COLOR = 16764928,
    EMBED_ERROR_COLOR = 16716876;

const GenUserInfoEmbeds = async (user) => {
    const embeds = [];

    if(!user) {
        embeds.push({
            description: 'Указан несуществующий пользователь.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    embeds.push({
        title: `${user.username}\`#${user.discriminator}\``,
        thumbnail: { url: Tools.Resource.UserAvatar(user) },
        color: EMBED_MESSAGE_COLOR,
        fields: [
            {
                name: 'Дата создания',
                value: Tools.Format.Timestamp(Math.trunc(GetUserCreationDate(user.id) / 1000), Helpers.TimestampStyles.SHORT_DATE_TIME),
            },
        ],
    });

    const xgmid = AuthUsers.get(user.id);
    if(!xgmid) {
        embeds.push({
            description: 'Нет привязки к XGM.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    const xgmres = await RequestXgmUser(xgmid).catch(Logger.Error);
    if(!xgmres) {
        embeds.push({
            description: 'Ошибка запроса к XGM.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    const { info } = xgmres;
    if(!info) {
        embeds.push({
            description: 'Привязан к несуществующему пользователю XGM.',
            color: EMBED_ERROR_COLOR,
        });
        return embeds;
    }

    embeds.push({
        title: info.user.username,
        url: GenXgmUserLink(xgmid),
        thumbnail: {
            url: info.avatar.big.startsWith('https:') ?
                info.avatar.big :
                `https://xgm.guru/${info.avatar.big}`,
        },
        fields: [
            {
                name: 'Уровень',
                value: String(info.user.level),
            },
            {
                name: 'Опыт',
                value: String(info.user.level_xp),
            },
        ],
        color: EMBED_MESSAGE_COLOR,
    });

    return embeds;
};

export const HandleInteraction = async (interaction) => {
    if(interaction.type != Helpers.InteractionTypes.APPLICATION_COMMAND) return;

    const
        { data } = interaction,
        user = interaction.member?.user ?? interaction.user;

    if(!(data && user)) return;
    if(!config.commands.includes(data.id)) return;

    Logger.Log(`COMMAND: ${data.name} USER: ${user.username}#${user.discriminator}`);

    const
        targetId = data.options?.find((p) => p.name == 'user')?.value ?? data.target_id,
        showPublic = Boolean(data.options?.find((p) => p.name == 'public')?.value);

    Actions.Application.CreateInteractionResponse(interaction.id, interaction.token, {
        type: Helpers.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            embeds: await GenUserInfoEmbeds((typeof targetId == 'string') ? data.resolved?.users?.[targetId] : user),
            flags: showPublic ? Helpers.MessageFlags.NO_FLAGS : Helpers.MessageFlags.EPHEMERAL,
        },
    }).catch(Logger.Error);
};
