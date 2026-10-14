// NativeWind 4 trae su propio plugin de Reanimated (que en Reanimated 4 delega
// en Worklets). Por eso se apaga el que babel-preset-expo agrega solo: si no,
// el plugin de worklets corre dos veces sobre cada archivo.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind', reanimated: false }], 'nativewind/babel'],
  };
};
