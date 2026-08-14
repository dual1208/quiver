// Expo loads Metro configuration through CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
