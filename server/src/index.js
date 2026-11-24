import { createApp } from './app.js';
import { loadConfig } from './config.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`[hope] ${err.message}`);
  process.exit(1);
}

const server = createApp(config);
server.listen(config.port, config.host, () => {
  console.log(`[hope] listening on http://${config.host}:${config.port} (planner: ${config.provider}, model: ${config.plannerModel})`);
  if (config.provider === 'mock') {
    console.log('[hope] no API key set, using the rule-based mock planner. See .env.example.');
  }
});
