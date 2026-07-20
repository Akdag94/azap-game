// Gömülü web istemcisi için: css/png + .txt (app.js/index.html/manifest'in
// asset-güvenli kopyaları) Metro tarafından ASSET olarak paketlensin.
// (.js/.json doğrudan require edilirse Metro onları kaynak modül sanıp çalıştırır
//  ve web kodu native ortamda patlar — bu yüzden .txt kopyaları kullanıyoruz.)
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('txt')) config.resolver.assetExts.push('txt');
if (!config.resolver.assetExts.includes('css')) config.resolver.assetExts.push('css');

module.exports = config;
