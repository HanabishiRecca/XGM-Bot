import Logger from '../util/log.js';
import config from '../util/config.js';
import { RequestXgmUser, GenXgmUserLink, GetUserCreationDate } from '../util/users.js';
import { AuthUsers } from './state.js';
import { Actions, Helpers, Tools, Types } from 'discord-slim';

const
    EMBED_MESSAGE_COLOR = 16764928,
    EMBED_ERROR_COLOR = 16716876,
    OPTION_USER = 'user',
    OPTION_PUBLIC = 'public';

let knownCommands: Set<string> | undefined;

const GenUserInfoEmbeds = async (user?: Types.User) => {
    const embeds: Types.Embed[] = [];

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

const ExtractOption = ({ options }: Types.InteractionData, name: string) =>
    options?.find((option) => option.name == name)?.value;

const ExtractInteractionData = async (data?: Types.InteractionData, user?: Types.User) => {
    if(!(data && user)) return;

    Logger.Log(`COMMAND: ${data.name} USER: ${user.username}#${user.discriminator}`);

    if(!knownCommands?.has(data.id)) return;

    const
        target = String(ExtractOption(data, OPTION_USER) ?? data.target_id ?? ''),
        show = Boolean(ExtractOption(data, OPTION_PUBLIC));

    return {
        embeds: await GenUserInfoEmbeds(data.resolved?.users?.[target] ?? user),
        flags: show ? Helpers.MessageFlags.NO_FLAGS : Helpers.MessageFlags.EPHEMERAL,
    };
};

export const HandleInteraction = async (interaction: Types.Interaction) => {
    if(interaction.type != Helpers.InteractionTypes.APPLICATION_COMMAND) return;

    const data = await ExtractInteractionData(interaction.data, interaction.member?.user ?? interaction.user);
    if(!data) return;

    Actions.Application.CreateInteractionResponse(interaction.id, interaction.token, {
        type: Helpers.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
        data,
    }).catch(Logger.Error);
};

export const RegisterCommands = async (id: string) => {
    if(knownCommands) return;
    knownCommands = new Set();

    const commands = await Actions.Application.BulkOverwriteGuildCommands(id, config.server, [
        {
            name: 'who',
            description: 'Показать информацию о пользователе.',
            options: [
                {
                    name: OPTION_USER,
                    description: 'Пользователь',
                    type: Helpers.ApplicationCommandOptionTypes.USER,
                    required: false,
                },
                {
                    name: OPTION_PUBLIC,
                    description: 'Показать для всех',
                    type: Helpers.ApplicationCommandOptionTypes.BOOLEAN,
                    required: false,
                },
            ],
        },
        {
            name: 'Идентификация',
            type: Helpers.ApplicationCommandTypes.USER,
            description: '',
        },
    ]);

    for(const { id } of commands)
        knownCommands.add(id);
};
