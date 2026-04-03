import { refreshRollingWindow } from './windowed/pipeline.mjs';
import { getRefreshOptionsFromEnv } from './windowed/env-options.mjs';

const result = await refreshRollingWindow(getRefreshOptionsFromEnv());
console.log(JSON.stringify(result, null, 2));
