import Logger from '../util/log';

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

import { LoadConfig } from '../util/config';
import { HttpsGet } from '../util/request';
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { Authorization, Actions, Types } from 'discord-slim';

const
    config = LoadConfig('news'),
    DB_PATH = `${STORAGE}/news_timestamp`,
    FEED_URL = 'https://xgm.guru/rss',
    fileOptions = { encoding: 'utf8' } as const;

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
    color: config.embed_color,
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
        messages = await Actions.Channel.GetMessages(webhook.channel_id, { limit: config.back_messages_limit });

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

const ReadTimestamp = () => {
    try {
        return Number(readFileSync(DB_PATH, fileOptions));
    } catch(e: any) {
        if(e?.code != 'ENOENT') throw e;
    }
};

const WriteTimestamp = (timestamp: number) => {
    const np = `${DB_PATH}.new`;
    writeFileSync(np, String(timestamp), fileOptions);
    renameSync(np, DB_PATH);
};

const StartJob = async () => {
    Logger.Log('Loading data...');

    const result = await CheckNews(ReadTimestamp());
    if(!result) return;

    Logger.Log('Saving data...');
    WriteTimestamp(result);
};

(async () => {
    Logger.Log('News check job start.');
    await StartJob();
    Logger.Log('News check job finished.');
})();
