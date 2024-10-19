import Logger from "../util/log";
import { LoadConfig } from "../util/config";
import {
    RequestXgmUser,
    SyncUser,
    ClearUser,
    GenXgmUserLink,
    MemberPart,
} from "../util/users";
import { config as botConfig, AuthUsers } from "./state";
import { Actions, Helpers, Types } from "discord-slim";

const OPTION_USER = "user";
const OPTION_PUBLIC = "public";
const config = LoadConfig("commands");

const GenUserInfo = async (member: MemberPart): Promise<Types.Embed> => {
    const xgmid = AuthUsers.get(member.user.id);
    if (!xgmid) {
        ClearUser(botConfig.server, member);
        return {
            description: "Нет привязки к XGM.",
            color: config.embed_error_color,
        };
    }

    const xgmuser = await RequestXgmUser(xgmid).catch(Logger.Error);
    if (!xgmuser) {
        return {
            description: "Ошибка запроса к XGM.",
            color: config.embed_error_color,
        };
    }

    const { info } = xgmuser;
    if (!info) {
        ClearUser(botConfig.server, member);
        return {
            description: "Привязан к несуществующему пользователю XGM.",
            color: config.embed_error_color,
        };
    }

    SyncUser(botConfig.server, member, xgmid, false, xgmuser);

    return {
        title: info.user.username,
        url: GenXgmUserLink(xgmid),
        thumbnail: {
            url: info.avatar.exits ? `https://xgm.guru/${info.avatar.big}` : "",
        },
        fields: [
            {
                name: "Уровень",
                value: String(info.user.level),
            },
            {
                name: "Опыт",
                value: String(info.user.level_xp),
            },
        ],
        color: config.embed_message_color,
    };
};

const FindOption = (options: Types.InteractionDataOption[], name: string) =>
    options.find((option) => option.name == name);

const ExtractInteractionData = async (
    { options, target_id, resolved }: Types.InteractionData,
    sender: Types.Member,
) => {
    let member = sender as MemberPart;
    let target = "";
    let show = false;

    if (target_id) {
        target = target_id;
    } else if (options) {
        const userOption = FindOption(options, OPTION_USER);
        if (userOption?.type == Helpers.ApplicationCommandOptionTypes.USER)
            target = userOption.value;

        const publicOption = FindOption(options, OPTION_PUBLIC);
        if (publicOption?.type == Helpers.ApplicationCommandOptionTypes.BOOLEAN)
            show = publicOption.value;
    }

    if (target && resolved) {
        const user = resolved.users?.[target];
        if (user) member = { ...resolved.members?.[target], user };
    }

    return {
        embeds: [await GenUserInfo(member)],
        flags: show
            ? Helpers.MessageFlags.NO_FLAGS
            : Helpers.MessageFlags.EPHEMERAL,
    };
};

export const HandleInteraction = async ({
    data,
    member,
    type,
    id,
    token,
}: Types.Interaction) => {
    if (
        !(
            data &&
            member &&
            type == Helpers.InteractionTypes.APPLICATION_COMMAND
        )
    )
        return;

    Logger.Debug(`COMMAND: ${data.name} USER: ${member.user.username}`);

    Actions.Application.CreateInteractionResponse(id, token, {
        type: Helpers.InteractionCallbackTypes.CHANNEL_MESSAGE_WITH_SOURCE,
        data: await ExtractInteractionData(data, member),
    }).catch(Logger.Error);
};

let done = false;

export const RegisterCommands = (id: string) => {
    if (done) return;
    done = true;

    Actions.Application.BulkOverwriteGlobalCommands(id, [
        {
            name: "who",
            type: Helpers.ApplicationCommandTypes.CHAT_INPUT,
            description: "Показать информацию о пользователе.",
            options: [
                {
                    name: OPTION_USER,
                    description: "Пользователь",
                    type: Helpers.ApplicationCommandOptionTypes.USER,
                    required: false,
                },
                {
                    name: OPTION_PUBLIC,
                    description: "Показать для всех",
                    type: Helpers.ApplicationCommandOptionTypes.BOOLEAN,
                    required: false,
                },
            ],
        },
        {
            type: Helpers.ApplicationCommandTypes.USER,
            name: "Идентификация",
        },
    ]);
};
