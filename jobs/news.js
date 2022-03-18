'use strict';

import Logger from '../util/log.js';

const Shutdown = (e) => {
    Logger.Error(e);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

const {
    WH_NEWS_ID,
    WH_NEWS_TOKEN,
    STORAGE,
    TOKEN,
} = process.env;

const Check = (value, message) => value || Shutdown(message);

Check(WH_NEWS_ID, 'News webhook id required.');
Check(WH_NEWS_TOKEN, 'News webhook token required.');
Check(STORAGE, 'Storage path required.');
Check(TOKEN, 'Bot token required.');

import Storage from '../util/storage.js';
import { HttpsGet } from '../util/misc.js';
import { XMLParser } from 'fast-xml-parser';
import { Authorization, Actions } from 'discord-slim';

const
    dbPath = `${STORAGE}/app.db`,
    AppState = Storage.Load(dbPath),
    paramName = 'lastNewsTime';

const SaveAppState = () =>
    Storage.Save(AppState, dbPath);

const requestOptions = {
    authorization: new Authorization(TOKEN),
    rateLimit: {
        retryCount: 1,
        callback: (response, attempts) =>
            Logger.Warn(`${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`),
    },
};

const DecodeHtmlEntity = (() => {
    const
        htmlEntities = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>' },
        decodeEntity = (_, dec) => htmlEntities[dec],
        decodeSymbol = (_, dec) => String.fromCodePoint(dec),
        re = /&(nbsp|amp|quot|lt|gt);/g,
        rc = /&#(\d+);/g;

    return (str) => str.replace(re, decodeEntity).replace(rc, decodeSymbol);
})();

const CleanupHtml = (str) => str.replace(/<\/?[^<>]*>/gm, '');

(async () => {
    Logger.Log('News check job start.');

    const data = await HttpsGet('https://xgm.guru/rss').catch(Shutdown);
    if(!data?.length) Shutdown('No data received.');

    const items = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(data)?.rss?.channel?.item;
    if(!items?.length) Shutdown('Incorrect data received.');

    const lastTime = AppState.get(paramName) ?? Date.now();

    let maxTime = 0, posts;

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
                description: CleanupHtml(DecodeHtmlEntity(item.description)),
                url: item.link,
                footer: { text: item.author },
                timestamp: dt.toISOString(),
                color: 16764928,
                image: item.enclosure ? { url: item.enclosure.url } : null,
            };

            if(!posts) {
                const webhook = await Actions.Webhook.GetWithToken(WH_NEWS_ID, WH_NEWS_TOKEN);
                posts = await Actions.Channel.GetMessages(webhook.channel_id, { limit: items.length }, requestOptions);
            }

            const pre = posts.find((post) => post.embeds?.[0]?.url == item.link);
            pre ?
                await Actions.Webhook.EditMessage(WH_NEWS_ID, WH_NEWS_TOKEN, pre.id, { embeds: [embed] }) :
                await Actions.Webhook.Execute(WH_NEWS_ID, WH_NEWS_TOKEN, { embeds: [embed] });
        }
    }

    if(lastTime != maxTime) {
        AppState.set(paramName, maxTime);
        SaveAppState();
    }

    Logger.Log('News check job finished.');
    process.exit();
})();
