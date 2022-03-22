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
    BACK_MESSAGES_LIMIT = 10,
    NEWS_COLOR = 16764928;

Actions.setDefaultRequestOptions({
    authorization: new Authorization(TOKEN),
    rateLimit: {
        retryCount: 1,
        callback: (response, attempts) =>
            Logger.Warn(`${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`),
    },
});

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
};

type ItemInfo = {
    item: FeedItem;
    date: Date;
};

const FetchFeed = async () => {
    const data = await HttpsGet(FEED_URL);
    if(!data) throw 'No feed data received.';

    const items = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
    }).parse(data)?.rss?.channel?.item as FeedItem[] | undefined;

    if(!items) throw 'Incorrect feed data received.';

    return items;
};

const GenEmbed = ({ item, date }: ItemInfo) => ({
    title: DecodeHtmlEntity(item.title),
    description: CleanupHtml(DecodeHtmlEntity(item.description)),
    url: item.link,
    footer: {
        text: item.author,
    },
    timestamp: date.toISOString(),
    color: NEWS_COLOR,
    image: {
        url: item.enclosure?.url,
    },
});

const EditMessage = (info: ItemInfo, id: string) =>
    Actions.Webhook.EditMessage(WH_NEWS_ID, WH_NEWS_TOKEN, id, {
        embeds: [GenEmbed(info)],
    });

const PostMessage = async (info: ItemInfo) => {
    const embed = GenEmbed(info);

    const { id, channel_id } = await Actions.Webhook.Execute(
        WH_NEWS_ID,
        WH_NEWS_TOKEN,
        { embeds: [embed] },
        { wait: true },
    ) as Types.Message;

    await Actions.Message.Crosspost(channel_id, id).catch(Logger.Error);

    await Actions.Thread.StartWithMessage(channel_id, id, {
        name: embed.title.replace(/[\/\\]/g, '|'),
    }).catch(Logger.Error);
};

const PostNews = async (infos: ItemInfo[]) => {
    const
        webhook = await Actions.Webhook.GetWithToken(WH_NEWS_ID, WH_NEWS_TOKEN),
        messages = await Actions.Channel.GetMessages(webhook.channel_id, { limit: BACK_MESSAGES_LIMIT });

    const FindExisting = (link: string) => {
        if(!link) return;
        return messages.find(({ embeds }) => embeds?.[0]?.url == link)?.id;
    };

    for(const info of infos) {
        const id = FindExisting(info.item.link);
        await (id ?
            EditMessage(info, id) :
            PostMessage(info)
        );
    }
};

const CheckNews = async (checkTime?: number) => {
    if(!checkTime) return Date.now();

    Logger.Log('Fetching rss feed...');
    const items = await FetchFeed();

    Logger.Log('Processing feed...');

    const infos = items.map((item) => ({
        date: new Date(item.pubDate),
        item,
    } as ItemInfo)).filter(
        ({ date }) => date.getTime() > checkTime,
    ).reverse();

    Logger.Log(`News count: ${infos.length}`);
    if(!infos.length) return;

    Logger.Log('Posting...');
    await PostNews(infos);

    return infos.reduce(
        (time, { date }) => Math.max(time, date.getTime()),
        checkTime,
    );
};

const StartJob = async () => {
    Logger.Log('Loading data...');
    const app = Storage.Load<string, number>(DB_PATH);

    const result = await CheckNews(app.get(PARAM_NAME));
    if(!result) return;

    Logger.Log('Saving data...');
    app.set(PARAM_NAME, result);
    Storage.Save(app, DB_PATH);
};

(async () => {
    Logger.Log('News check job start.');
    await StartJob();
    Logger.Log('News check job finished.');
    process.exit();
})();
