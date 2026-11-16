const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Share the small display formatter with Electron without copying its rules.
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../lib')];
module.exports = config;
