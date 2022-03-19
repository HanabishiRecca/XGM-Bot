import type { IncomingMessage } from 'http';
import { get } from 'https';

export const ReadIncomingData = (incoming: IncomingMessage) => new Promise<Buffer | null>((resolve, reject) => {
    const chunks: any[] = [];
    let dataLen = 0;

    incoming.on('data', (chunk) => {
        chunks.push(chunk);
        dataLen += chunk.length;
    });

    incoming.on('end', () => {
        if(!incoming.complete)
            return reject('Response error.');

        if(dataLen == 0)
            return resolve(null);

        if(chunks.length == 1)
            return resolve(chunks[0]);

        resolve(Buffer.concat(chunks, dataLen));
    });
});

export const HttpsGet = (url: string) => new Promise<Buffer | null>((resolve, reject) => {
    get(url, (response) => {
        if(response.statusCode != 200) return reject(response);
        ReadIncomingData(response).then(resolve).catch(reject);
    });
});
