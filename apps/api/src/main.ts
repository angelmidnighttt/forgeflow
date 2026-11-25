import { EnvValidationError } from '@forgeflow/config';
import { createApp } from './app.factory.js';
import { loadApiEnv } from './config/env.js';

try {
  const env = loadApiEnv();
  const app = await createApp(env);
  await app.listen(env.API_PORT);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
  } else {
    console.error('API failed to start:', error);
  }
  process.exit(1);
}
