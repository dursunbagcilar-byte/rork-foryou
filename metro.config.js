const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);

// SDK 54 için cache temizleme ve optimizasyonları
config.resetCache = true;
config.cacheVersion = '1.0';

// Watchman hatalarını önlemek için
config.watchFolders = [__dirname];

module.exports = withRorkMetro(config);
