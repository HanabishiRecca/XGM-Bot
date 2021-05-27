'use strict';

import Logger from './log.js';

const Shutdown = (err) => {
    Logger.Error(err);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

Logger.Log('News check job start.');

!process.env.TOKEN && Shutdown('Token required.');
!process.env.STORAGE && Shutdown('Storage path required.');

import Database from 'nedb-promise';
import XmlParser from 'fast-xml-parser';
import { Authorization, Actions } from 'discord-slim';
import { HttpsGet, DecodeHtmlEntity } from './misc.js';
import config from './config.js';

const appDb = Database({ filename: `${process.env.STORAGE}/app.db`, autoload: true });

const appOptions = {
    lastNewsTime: { _id: 'lastNewsTime' },
};

Actions.setDefaultRequestOptions({
    authorization: new Authorization(process.env.TOKEN),
});

(async () => {
    const data = await HttpsGet('https://xgm.guru/rss');
    if(!data?.length) return;

    const feed = XmlParser.parse(data.toString(), { ignoreAttributes: false, attributeNamePrefix: '' });
    if(!feed?.rss?.channel?.item) return;

    const
        option = await appDb.findOne(appOptions.lastNewsTime),
        lastTime = option ? option.value : Date.now(),
        items = feed.rss.channel.item;

    let maxTime = 0;
    for(let i = items.length - 1; i >= 0; i--) {
        const
            item = items[i],
            dt = new Date(item.pubDate),
            time = dt.getTime();

        if(time > maxTime)
            maxTime = time;

        if(time > lastTime) {
            const embed = {
                title: DecodeHtmlEntity(item.title),
                description: DecodeHtmlEntity(item.description.replace(/<\/?[^<>]*>/gm, '')),
                url: item.link,
                footer: { text: item.author },
                timestamp: dt.toISOString(),
                color: 16764928,
                image: item.enclosure ? { url: item.enclosure.url } : null,
            };
            await Actions.Message.Create(config.channel.news, { embed });

            embed.timestamp = undefined;
            await Actions.Message.Create(config.channel.newsCode, { content: `\`\`\`b/post\n${JSON.stringify({ content: 'https://discord.gg/TuSHPU6', embed }, null, 4)}\`\`\`` });
        }
    }

    if(lastTime != maxTime) {
        await appDb.update(appOptions.lastNewsTime, { $set: { value: maxTime } }, { upsert: true });
        appDb.nedb.persistence.compactDatafile();
    }

    Logger.Log('News check job finished.');
})();
