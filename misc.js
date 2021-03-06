'use strict';

import https from 'https';

const htmlEntities = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>' };
export const DecodeHtmlEntity = (str) => str.replace(/&amp;/g, '&').replace(/&(nbsp|amp|quot|lt|gt);/g, (_, dec) => htmlEntities[dec]).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(dec));

export const ReadIncomingData = (incoming) => new Promise((resolve, reject) => {
    const chunks = [];
    let dataLen = 0;

    incoming.on('data', chunk => {
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
    https.get(url, response => {
        if(response.statusCode != 200) return resolve(null);
        ReadIncomingData(response).then(resolve).catch(reject);
    });
});
