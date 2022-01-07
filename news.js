'use strict';

import Logger from './log.js';

const Shutdown = (err) => {
    Logger.Error(err);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

Logger.Log('News check job start.');

const WH_NEWS_ID = process.env.WH_NEWS_ID, WH_NEWS_TOKEN = process.env.WH_NEWS_TOKEN;

!(WH_NEWS_ID && WH_NEWS_TOKEN) && Shutdown('No credentials.');
!process.env.STORAGE && Shutdown('Storage path required.');

import Database from 'nedb-promise';
import { XMLParser } from 'fast-xml-parser';
import { Actions } from 'discord-slim';
import { HttpsGet, DecodeHtmlEntity } from './misc.js';

const appDb = Database({ filename: `${process.env.STORAGE}/app.db`, autoload: true });

const lastNewsTime = { _id: 'lastNewsTime' };

(async () => {
    const data = await HttpsGet('https://xgm.guru/rss');
    if(!data?.length) Shutdown('No data received.');

    const items = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(data)?.rss?.channel?.item;
    if(!items?.length) Shutdown('Incorrect data received.');

    const
        option = await appDb.findOne(lastNewsTime),
        lastTime = option?.value ?? Date.now();

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
            await Actions.Webhook.Execute(WH_NEWS_ID, WH_NEWS_TOKEN, { embeds: [embed] }).catch(Logger.Error);
        }
    }

    if(lastTime != maxTime) {
        await appDb.update(lastNewsTime, { $set: { value: maxTime } }, { upsert: true });
        appDb.nedb.persistence.compactDatafile();
    }

    Logger.Log('News check job finished.');
    process.exit();
})();
