// Gömülü web istemcisi (webassets/) için html/css dosyalarını asset olarak paketle
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('html', 'css');

module.exports = config;
