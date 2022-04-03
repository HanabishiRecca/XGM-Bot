import Logger from '../util/log.js';
import config from '../util/config.js';
import { CLIENT_ID } from './process.js';
import { Actions, Tools, Types } from 'discord-slim';

type Reaction = {
    user_id: string;
    channel_id: string;
    message_id: string;
    guild_id?: string;
    member?: Types.Member;
    emoji: Types.Emoji;
};

export const ReactionProc = ({ user_id, channel_id, message_id, emoji: { id } }: Reaction, add: boolean) => {
    if(!id || (user_id == CLIENT_ID)) return;

    const role = config.marks[channel_id]?.[message_id]?.[id];
    if(!role) return;

    const f = add ? Actions.Member.AddRole : Actions.Member.RemoveRole;
    f(config.server, user_id, role).catch(Logger.Error);
};

let marksSet = false;

export const SetMarks = async (emojis: Types.Emoji[]) => {
    if(marksSet) return;
    marksSet = true;

    const emojiMap = new Map();
    for(const emoji of emojis)
        emojiMap.set(emoji.id, emoji);

    for(const channel_id of Object.getOwnPropertyNames(config.marks)) {
        const messages = await Actions.Channel.GetMessages(channel_id, { limit: 10 }).catch(Logger.Error);
        if(!messages) continue;

        const channel = config.marks[channel_id];
        if(!channel) continue;

        for(const message_id of Object.getOwnPropertyNames(channel)) {
            const { reactions } = messages.find(({ id }) => id == message_id) ?? {};
            if(!reactions) continue;

            const message = channel[message_id];
            if(!message) continue;

            for(const eid of Object.getOwnPropertyNames(message)) {
                if(reactions.find(({ emoji: { id } }) => id == eid)) continue;
                await Actions.Reaction.Add(channel_id, message_id, Tools.Format.Reaction(emojiMap.get(eid))).catch(Logger.Error);
            }
        }
    }
};