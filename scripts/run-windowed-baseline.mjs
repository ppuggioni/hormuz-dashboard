import { createBaseline } from './windowed/pipeline.mjs';
import { getBaselineOptionsFromEnv } from './windowed/env-options.mjs';

const result = await createBaseline(getBaselineOptionsFromEnv());
console.log(JSON.stringify(result, null, 2));
