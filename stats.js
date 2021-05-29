'use strict';

import Logger from './log.js';

const Shutdown = (err) => {
    Logger.Error(err);
    process.exit(1);
};

process.on('uncaughtException', Shutdown);
process.on('unhandledRejection', Shutdown);

Logger.Log('Stats job start.');

!(process.env.TOKEN
    && process.env.MDB_HOST
    && process.env.MDB_DATABASE
    && process.env.MDB_USER
    && process.env.MDB_PASSWORD
) && Shutdown('No credentials.');

import MariaDB from 'mariadb';
import { Authorization, Actions, Tools } from 'discord-slim';
import config from './config.js';

(async () => {
    const connection = await MariaDB.createConnection({
        host: process.env.MDB_HOST,
        database: process.env.MDB_DATABASE,
        user: process.env.MDB_USER,
        password: process.env.MDB_PASSWORD,
        bigNumberStrings: true,
    });

    const stats = await connection.query('select user,count(id) from messages where (dt > (NOW() - INTERVAL 7 DAY)) group by user order by count(id) desc limit 20;');

    connection.end();

    let text = '', index = 1;

    if(stats)
        for(const stat of stats)
            text += `${index++}. ${Tools.Mentions.User(stat.user)} → ${stat['count(id)']}\n`;

    await Actions.Message.Edit(config.stats.channel, config.stats.message, {
        embed: {
            title: 'Топ активности за неделю',
            description: text,
            timestamp: new Date().toISOString(),
            color: 16764928,
        },
    }, { authorization: new Authorization(process.env.TOKEN) });

    Logger.Log('Stats job finished.');
    process.exit();
})();
