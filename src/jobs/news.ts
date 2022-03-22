import Logger from '../util/log.js';

const Shutdown = (e: any) => {
    Logger.Error(e);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

const {
    WH_NEWS_ID = Shutdown('News webhook id required.'),
    WH_NEWS_TOKEN = Shutdown('News webhook token required.'),
    STORAGE = Shutdown('Storage path required.'),
    TOKEN = Shutdown('Bot token required.'),
} = process.env;

import Storage from '../util/storage.js';
import { HttpsGet } from '../util/request.js';
import { XMLParser } from 'fast-xml-parser';
import { Authorization, Actions, Types } from 'discord-slim';

const
    DB_PATH = `${STORAGE}/app.db`,
    FEED_URL = 'https://xgm.guru/rss',
    PARAM_NAME = 'lastNewsTime',
    NEWS_COLOR = 16764928;

const requestOptions = {
    authorization: new Authorization(TOKEN),
    rateLimit: {
        retryCount: 1,
        callback: (response: {
            message: string;
            retry_after: number;
            global: boolean;
        }, attempts: number) =>
            Logger.Warn(`${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`),
    },
};

const DecodeHtmlEntity = (() => {
    const
        htmlEntities: { [key: string]: string | undefined; } = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>' },
        decodeEntity = (_: string, dec: string) => htmlEntities[dec] ?? '',
        decodeSymbol = (_: string, dec: string) => String.fromCodePoint(Number(dec)),
        re = /&(nbsp|amp|quot|lt|gt);/g,
        rc = /&#(\d+);/g;

    return (str: string) => str.replace(re, decodeEntity).replace(rc, decodeSymbol);
})();

const CleanupHtml = (str: string) =>
    str.replace(/<\/?[^<>]*>/gm, '');

type FeedItem = {
    title: string;
    author: string;
    description: string;
    link: string;
    pubDate: string;
    enclosure: {
        url: string;
    };
    __dt?: Date;
};

const FetchFeed = async () => {
    const data = await HttpsGet(FEED_URL);
    if(!data?.length) return Shutdown('No feed data received.');

    const items = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
    }).parse(data)?.rss?.channel?.item as FeedItem[] || undefined;

    return items?.length ?
        items.reverse() : Shutdown('Incorrect feed data received.');
};

const PostItem = async (item: FeedItem, message?: Types.Message) => {
    const embed: Types.Embed = {
        title: DecodeHtmlEntity(item.title),
        description: CleanupHtml(DecodeHtmlEntity(item.description)),
        url: item.link,
        footer: {
            text: item.author,
        },
        timestamp: item.__dt?.toISOString(),
        color: NEWS_COLOR,
        image: {
            url: item.enclosure?.url,
        },
    };

    const param = { embeds: [embed] };

    message ?
        await Actions.Webhook.EditMessage(WH_NEWS_ID, WH_NEWS_TOKEN, message.id, param) :
        await Actions.Webhook.Execute(WH_NEWS_ID, WH_NEWS_TOKEN, param);
};

const CheckNews = async (items: FeedItem[], lastTime: number) => {
    const newItems = items.filter((item) =>
        (item.__dt = new Date(item.pubDate)).getTime() > lastTime);

    if(newItems.length < 1)
        return lastTime;

    const
        webhook = await Actions.Webhook.GetWithToken(WH_NEWS_ID, WH_NEWS_TOKEN),
        messages = await Actions.Channel.GetMessages(webhook.channel_id, { limit: items.length }, requestOptions);

    for(const item of newItems) {
        const message = item.link ?
            messages.find(({ embeds }) => embeds?.[0]?.url == item.link) :
            undefined;

        try {
            await PostItem(item, message);
        } catch(e) {
            Logger.Error(e);
            break;
        }

        const time = item.__dt?.getTime() ?? 0;
        if(time > lastTime)
            lastTime = time;
    }

    return lastTime;
};

(async () => {
    Logger.Log('News check job start.');

    Logger.Log('Loading data...');
    const app = Storage.Load<string, number>(DB_PATH);

    Logger.Log('Fetching rss feed...');
    const items = await FetchFeed();

    const lastTime = app.get(PARAM_NAME);
    let needSave = false;

    if(lastTime) {
        Logger.Log('Processing feed...');
        const time = await CheckNews(items, lastTime);
        if(needSave = (time > lastTime))
            app.set(PARAM_NAME, time);
    } else {
        Logger.Warn('Last check timestamp not found.');
        app.set(PARAM_NAME, Date.now());
        needSave = true;
    }

    if(needSave) {
        Logger.Log('Saving data...');
        Storage.Save(app, DB_PATH);
    }

    Logger.Log('News check job finished.');
    process.exit();
})();
