const { getDefaultConfig } = require("expo/metro-config");
const cfg = getDefaultConfig(__dirname);
cfg.resolver.assetExts.push("db");
module.exports = cfg;
