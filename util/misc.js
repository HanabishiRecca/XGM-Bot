'use strict';

import https from 'https';

export const
    GenXgmUserLink = (xgmid) => `https://xgm.guru/user/${xgmid}`,
    GetUserCreationDate = (user_id) => Number(BigInt(user_id) >> 22n) + 1420070400000;

export const GenMap = (arr) => {
    const map = new Map();
    if(Array.isArray(arr))
        for(const elem of arr)
            map.set(elem.id, elem);
    return map;
};

export const ReadIncomingData = (incoming) => new Promise((resolve, reject) => {
    const chunks = [];
    let dataLen = 0;

    incoming.on('data', (chunk) => {
        chunks.push(chunk);
        dataLen += chunk.length;
    });

    incoming.on('end', () => {
        if(!incoming.complete)
            return reject('Response error.');

        if(dataLen == 0)
            return resolve();

        if(chunks.length == 1)
            return resolve(chunks[0]);

        resolve(Buffer.concat(chunks, dataLen));
    });
});

export const HttpsGet = (url) => new Promise((resolve, reject) => {
    https.get(url, (response) => {
        if(response.statusCode != 200) return reject(response);
        ReadIncomingData(response).then(resolve).catch(reject);
    });
});
