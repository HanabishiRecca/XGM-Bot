'use strict';

const htmlEntities = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>' };
exports.DecodeHtmlEntity = str => str.replace(/&amp;/g, '&').replace(/&(nbsp|amp|quot|lt|gt);/g, (_, dec) => htmlEntities[dec]).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(dec));

exports.FormatWarnTime = time => {
    let result = '';
    
    const days = Math.trunc(time / 86400000);
    if(days)
        result += `${days} д `;
    
    const hours = Math.trunc((time % 86400000) / 3600000);
    if(hours)
        result += `${hours} ч `;
        
    const minutes = Math.trunc((time % 3600000) / 60000);
    if(minutes)
        result += `${minutes} мин`;
    
    return result;
};

const https = require('https');
exports.HttpsGet = url => new Promise(resolve => {
    https.get(url, response => {
        if(response.statusCode != 200)
            return resolve(null);
        
        const chunks = [];
        let dataLen = 0;
        
        response.on('data', data => {
            chunks.push(data);
            dataLen += data.length;
        });
        
        response.on('end', () => {
            const data = Buffer.allocUnsafe(dataLen);
            let len = 0;
            
            for(let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                chunk.copy(data, len);
                len += chunk.length;
            }
            
            return resolve(data);
        });
    });
});

exports.GetMentions = str => {
    const
        result = [],
        regExp = /<@!?([0-9]+)>/g;
    
    let match;
    while(match = regExp.exec(str))
        if(match.length > 1)
            result.push(match[1]);
    
    return result;
};
