import { rerunAllWindowed } from './windowed/pipeline.mjs';
import { getRerunAllOptionsFromEnv } from './windowed/env-options.mjs';

const result = await rerunAllWindowed(getRerunAllOptionsFromEnv());
console.log(JSON.stringify(result, null, 2));
