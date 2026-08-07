// Pure hook file. Runs in the loader thread (separate from the main
// thread) when registered via `module.register()` or via `--import` of
// the companion `registerReactNative.mjs` shim.

const stubSource = `
export const AppState = {
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {},
  currentState: 'active',
};
export const Platform = { OS: 'ios', Version: 0, select: (v) => (v && v.ios) ?? v?.default };
export const NativeModules = {};
export const StyleSheet = { create: (x) => x, flatten: (x) => x };
export const View = function View() {};
export const Text = function Text() {};
export default { AppState, Platform, NativeModules, StyleSheet, View, Text };
`;

const stubUrl = 'data:text/javascript;base64,' + Buffer.from(stubSource).toString('base64');

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'react-native') {
    return { url: stubUrl, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}