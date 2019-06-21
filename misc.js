'use strict';

const htmlEntities = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>' };
exports.DecodeHtmlEntity = (str) => str.replace(/&(nbsp|amp|quot|lt|gt);/g, (match, dec) => htmlEntities[dec]).replace(/&#(\d+);/g, (match, dec) => String.fromCodePoint(dec));

const win1251chars = (() => {
    let result = '';
    for(let i = 0; i < 128; i++)
        result += String.fromCharCode(i);
    return result + 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–— ™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
})();

exports.Win1251ToUtf8 = (data) => {
    let result = '';
    for(let i = 0; i < data.length; i++)
        result += win1251chars[data[i]];
    return result;
};

exports.FormatWarnTime = (time) => {
    let result = '';
    
    const hrs = Math.trunc(time / 3600000);
    if(hrs > 0)
        result += hrs + ' ч. ';
    
    const mins = Math.ceil((time - (hrs * 3600000)) / 60000);
    if(mins > 0)
        result += mins + ' мин.';
    
    return result;
};
