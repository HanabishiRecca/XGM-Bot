import Logger from "./util/log";

const Shutdown = (e: any) => {
    Logger.Error(e);
    process.exit(1);
};

process.on("uncaughtException", Shutdown);
process.on("unhandledRejection", Shutdown);

const {
    WH_NEWS_ID = Shutdown("News webhook id required."),
    WH_NEWS_TOKEN = Shutdown("News webhook token required."),
    STORAGE = Shutdown("Storage path required."),
    TOKEN = Shutdown("Bot token required."),
} = process.env;

import { LoadConfig } from "./util/config";
import { HttpsGet } from "./util/request";
import { readFileSync, writeFileSync, renameSync } from "fs";
import { XMLParser } from "fast-xml-parser";
import { Authorization, Actions } from "discord-slim";

const config = LoadConfig("news");
const TIMESTAMP_FILE = `${STORAGE}/news_timestamp`;
const FEED_URL = "https://xgm.guru/rss";

Actions.setDefaultRequestOptions({
    authorization: new Authorization(TOKEN),
    rateLimit: {
        retryCount: 1,
        callback: (response, attempts) =>
            Logger.Warn(
                `${response.message} Global: ${response.global}. Cooldown: ${response.retry_after} sec. Attempt: ${attempts}.`,
            ),
    },
});

const DecodeHtmlEntity = (() => {
    const htmlEntities: Record<string, string> = {
        nbsp: " ",
        amp: "&",
        quot: '"',
        lt: "<",
        gt: ">",
    };
    const decodeEntity = (_: string, dec: string) => htmlEntities[dec] ?? "";
    const decodeSymbol = (_: string, dec: string) =>
        String.fromCodePoint(Number(dec));
    const re = /&(nbsp|amp|quot|lt|gt);/g;
    const rc = /&#(\d+);/g;

    return (str: string) =>
        str.replace(re, decodeEntity).replace(rc, decodeSymbol);
})();

const CleanupHtml = (str: string) => str.replace(/<\/?[^<>]*>/gm, "");

const GetString = (value: unknown) => (typeof value == "string" ? value : "");

type FeedItem = {
    "title"?: unknown;
    "dc:creator"?: unknown;
    "description"?: unknown;
    "link"?: unknown;
    "pubDate"?: unknown;
    "enclosure"?: {
        url?: unknown;
    };
};

type ItemInfo = {
    item: FeedItem;
    date: Date;
};

const FetchFeed = async () => {
    const data = await HttpsGet(FEED_URL);
    if (!data) throw "No feed data received.";

    const items = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
    }).parse(data)?.rss?.channel?.item as FeedItem[] | undefined;

    if (!items) throw "Incorrect feed data received.";
    return items;
};

const GenEmbed = ({ item, date }: ItemInfo) => ({
    title: DecodeHtmlEntity(GetString(item.title)),
    description: CleanupHtml(DecodeHtmlEntity(GetString(item.description))),
    url: GetString(item.link),
    footer: {
        text: GetString(item["dc:creator"]),
    },
    timestamp: date.toISOString(),
    color: config.embed_color,
    image: {
        url: GetString(item.enclosure?.url),
    },
});

const GenThreadName = (s: string) => s.replace(/[\/\\]/g, "|");

const EditMessage = async (info: ItemInfo, id: string) => {
    const embed = GenEmbed(info);

    await Actions.Webhook.EditMessage(WH_NEWS_ID, WH_NEWS_TOKEN, id, {
        embeds: [embed],
    }).catch(Logger.Error);

    await Actions.Thread.Modify(id, {
        name: GenThreadName(embed.title),
    }).catch(Logger.Error);
};

const PostMessage = async (info: ItemInfo) => {
    const embed = GenEmbed(info);

    const { id, channel_id } = await Actions.Webhook.Execute(
        WH_NEWS_ID,
        WH_NEWS_TOKEN,
        { embeds: [embed] },
        { wait: true },
    );

    await Actions.Message.Crosspost(channel_id, id).catch(Logger.Error);

    await Actions.Thread.StartWithMessage(channel_id, id, {
        name: GenThreadName(embed.title),
    }).catch(Logger.Error);
};

const PostNews = async (infos: ItemInfo[]) => {
    const webhook = await Actions.Webhook.GetWithToken(
        WH_NEWS_ID,
        WH_NEWS_TOKEN,
    );
    const messages = await Actions.Channel.GetMessages(webhook.channel_id, {
        limit: config.back_messages_limit,
    });

    const FindExisting = (link: string) => {
        if (!link) return;
        return messages.find(({ embeds }) => embeds?.[0]?.url == link)?.id;
    };

    let n = 0;

    for (const info of infos) {
        n++;
        Logger.Debug(`Posting ${n}/${infos.length}...`);

        const id = FindExisting(GetString(info.item.link));
        await (id ? EditMessage(info, id) : PostMessage(info));

        WriteTimestamp(info.date.getTime());
    }
};

const CheckNews = async (checkTime?: number) => {
    if (!checkTime) return Date.now();

    const infos: ItemInfo[] = (await FetchFeed())
        .map((item) => ({ date: new Date(GetString(item.pubDate)), item }))
        .filter(({ date }) => date.getTime() > checkTime)
        .reverse();

    if (!infos.length) return;
    Logger.Info(`News count: ${infos.length}`);
    await PostNews(infos);

    return infos.reduce(
        (time, { date }) => Math.max(time, date.getTime()),
        checkTime,
    );
};

const ReadTimestamp = () => {
    try {
        return Number(readFileSync(TIMESTAMP_FILE, { encoding: "utf8" }));
    } catch (e: any) {
        if (e?.code != "ENOENT") throw e;
    }
};

const WriteTimestamp = (timestamp: number) => {
    const np = `${TIMESTAMP_FILE}.new`;
    writeFileSync(np, String(timestamp), { encoding: "utf8" });
    renameSync(np, TIMESTAMP_FILE);
};

CheckNews(ReadTimestamp());
