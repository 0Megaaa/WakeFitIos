// Companion shim for `mockReactNative.mjs`. This file is loaded via
// `--import` from `scripts/runTests.mjs`. It runs in the main thread and
// uses `module.register()` to install the hooks defined in
// `mockReactNative.mjs` on the loader thread.

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = join(here, 'mockReactNative.mjs');
register(pathToFileURL(hookPath).href, import.meta.url);