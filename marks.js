'use strict';

import Logger from './log.js';
import config from './config.js';
import { Actions, Tools } from 'discord-slim';

const MarkMessages = (() => {
    const msgs = new Map();
    for(const mark of config.marks)
        msgs.has(mark.message) ?
            msgs.get(mark.message).marks.push(mark) :
            msgs.set(mark.message, { id: mark.message, channel: mark.channel, marks: [mark] });
    return msgs;
})();

export const ReactionProc = (reaction, add) => {
    const msg = MarkMessages.get(reaction.message_id);
    if(!msg) return;

    const mark = msg.marks.find((elem) => elem.emoji == reaction.emoji.id);
    if(!mark) return;

    (add ? Actions.Member.AddRole : Actions.Member.RemoveRole)
        (reaction.guild_id, reaction.user_id, mark.role).catch(Logger.Error);
};

export const SetMarks = (() => {
    let marksSynced = false;
    return async (serverEmojis) => {
        if(marksSynced) return;
        marksSynced = true;

        const emojiMap = new Map();
        for(const emoji of serverEmojis)
            emojiMap.set(emoji.id, emoji);

        for(const msg of MarkMessages.values()) {
            const message = await Actions.Message.Get(msg.channel, msg.id).catch(Logger.Error);
            if(!message) continue;

            for(const mark of msg.marks) {
                if(message.reactions.find((elem) => elem.emoji.id == mark.emoji)) continue;
                await Actions.Reaction.Add(message.channel_id, message.id, Tools.Format.Reaction(emojiMap.get(mark.emoji))).catch(Logger.Error);
            }
        }
    };
})();
