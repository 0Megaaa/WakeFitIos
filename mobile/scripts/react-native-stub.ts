// Minimal stub for `react-native` used during `npm test` only.
//
// The unit tests under `src/presentation/hooks/useWakeFitController.test.ts`
// import pure helpers from `useWakeFitController.ts`, which in turn
// imports `AppState` from `react-native`. Node does not have
// `react-native`, so we map the import here via the test-time tsconfig
// (`tsconfig.test.json`) and tsx's `paths` support.
//
// Only the symbols actually used by tested code paths are stubbed.

export const AppState = {
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {},
  currentState: 'active',
};

export const Platform = {
  OS: 'ios',
  Version: 0,
  select: (v) => v.ios ?? v.default,
};

export const NativeModules = {};
export const StyleSheet = { create: (x) => x, flatten: (x) => x };
export const View = function View() {};
export const Text = function Text() {};

export default { AppState, Platform, NativeModules, StyleSheet, View, Text };