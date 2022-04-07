import Logger from '../util/log';
import { LoadConfig } from '../util/config';
import { RequestXgmUser, SyncUser, ClearUser, GenXgmUserLink, MemberPart } from '../util/users';
import { config as botConfig, AuthUsers } from './state';
import { Actions, Helpers, Tools, Types } from 'discord-slim';

const
    OPTION_USER = 'user',
    OPTION_PUBLIC = 'public',
    config = LoadConfig('commands');

const GenUserInfoEmbeds = async (member: MemberPart) => {
    const
        embeds: Types.Embed[] = [],
        { user } = member;

    embeds.push({
        title: `${user.username}\`#${user.discriminator}\``,
        thumbnail: {
            url: Tools.Resource.UserAvatar(user),
        },
        color: config.embed_message_color,
        fields: [
            {
                name: 'Дата создания',
                value: Tools.Format.Timestamp(
                    Tools.Utils.GetUserCreationDate(user),
                    Helpers.TimestampStyles.SHORT_DATE_TIME,
                ),
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

const FindOption = (options: Types.InteractionDataOption[], name: string) =>
    options.find((option) => option.name == name);

const ExtractInteractionData = async ({ options, target_id, resolved }: Types.InteractionData, sender: Types.Member) => {
    let member = sender as MemberPart,
        target = '',
        show = false;

    if(target_id) {
        target = target_id;
    } else if(options) {
        const userOption = FindOption(options, OPTION_USER);
        if(userOption?.type == Helpers.ApplicationCommandOptionTypes.USER)
            target = userOption.value;

        const publicOption = FindOption(options, OPTION_PUBLIC);
        if(publicOption?.type == Helpers.ApplicationCommandOptionTypes.BOOLEAN)
            show = publicOption.value;
    }

    if(target && resolved) {
        const user = resolved.users?.[target];
        if(user)
            member = { ...resolved.members?.[target], user };
    }

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

    Actions.Application.CreateInteractionResponse(id, token, {
        type: Helpers.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
        data: await ExtractInteractionData(data, member),
    }).catch(Logger.Error);
};

let done = false;

export const RegisterCommands = (id: string) => {
    if(done) return;
    done = true;

    Actions.Application.BulkOverwriteGuildCommands(id, botConfig.server, [
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
        },
    ]);
};
