import Logger from '../util/log.js';
import { LoadConfig } from '../util/config.js';
import { RequestXgmUser, SyncUser, ClearUser, GenXgmUserLink, GetUserCreationDate, MemberPart } from '../util/users.js';
import { config as botConfig, AuthUsers } from './state.js';
import { Actions, Helpers, Tools, Types } from 'discord-slim';

const
    OPTION_USER = 'user',
    OPTION_PUBLIC = 'public';

const config = LoadConfig('commands');

let knownCommands: Set<string> | undefined;

const GenUserInfoEmbeds = async (member: MemberPart) => {
    const
        embeds: Types.Embed[] = [],
        { user } = member;

    embeds.push({
        title: `${user.username}\`#${user.discriminator}\``,
        thumbnail: { url: Tools.Resource.UserAvatar(user) },
        color: config.embed_message_color,
        fields: [
            {
                name: 'Дата создания',
                value: Tools.Format.Timestamp(Math.trunc(GetUserCreationDate(user.id) / 1000), Helpers.TimestampStyles.SHORT_DATE_TIME),
            },
        ],
    });

    const xgmid = AuthUsers.get(user.id);
    if(!xgmid) {
        ClearUser(botConfig.server, member);
        embeds.push({
            description: 'Нет привязки к XGM.',
            color: config.embed_error_color,
        });
        return embeds;
    }

    const xgmuser = await RequestXgmUser(xgmid).catch(Logger.Error);
    if(!xgmuser) {
        embeds.push({
            description: 'Ошибка запроса к XGM.',
            color: config.embed_error_color,
        });
        return embeds;
    }

    const { info } = xgmuser;
    if(!info) {
        ClearUser(botConfig.server, member);
        embeds.push({
            description: 'Привязан к несуществующему пользователю XGM.',
            color: config.embed_error_color,
        });
        return embeds;
    }

    SyncUser(botConfig.server, member, xgmid, false, xgmuser);

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
        color: config.embed_message_color,
    });

    return embeds;
};

const ExtractOption = (options: Types.InteractionData['options'], name: string) =>
    options?.find((option) => option.name == name)?.value;

const ExtractInteractionData = async ({ options, target_id, resolved }: Types.InteractionData, sender: Types.Member) => {
    const
        target = String(ExtractOption(options, OPTION_USER) ?? target_id ?? ''),
        show = Boolean(ExtractOption(options, OPTION_PUBLIC)),
        user = resolved?.users?.[target],
        member = user ? { ...resolved?.members?.[target], user } : sender;

    return {
        embeds: await GenUserInfoEmbeds(member),
        flags: show ? Helpers.MessageFlags.NO_FLAGS : Helpers.MessageFlags.EPHEMERAL,
    };
};

export const HandleInteraction = async ({ data, member, type, id, token }: Types.Interaction) => {
    if(!(data && member &&
        (type == Helpers.InteractionTypes.APPLICATION_COMMAND)
    )) return;

    const { user: { username, discriminator } } = member;
    Logger.Log(`COMMAND: ${data.name} USER: ${username}#${discriminator}`);
    if(!knownCommands?.has(data.id)) return;

    Actions.Application.CreateInteractionResponse(id, token, {
        type: Helpers.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
        data: await ExtractInteractionData(data, member),
    }).catch(Logger.Error);
};

export const RegisterCommands = async (id: string) => {
    if(knownCommands) return;
    knownCommands = new Set();

    const commands = await Actions.Application.BulkOverwriteGuildCommands(id, botConfig.server, [
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
