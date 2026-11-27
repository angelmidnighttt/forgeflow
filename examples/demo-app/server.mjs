// The demo app ForgeFlow watches: a tiny HTTP service whose deployments (and, in later phases,
// incidents) are the ones you see in ForgeFlow. No dependencies, Node 22.
//
//   APP_VERSION       what is deployed (the image tag), shown at / and /health
//   PORT              default 8080
//   FAULT_ERROR_RATE  0–1: share of requests to / answered 500, to stage an incident
//   FAULT_LATENCY_MS  extra delay before answering /, to stage a slowdown
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** Reads the settings from the environment; bad numbers fall back to "no fault". */
export function settingsFrom(env) {
  const rate = Number(env.FAULT_ERROR_RATE ?? 0);
  const latency = Number(env.FAULT_LATENCY_MS ?? 0);
  return {
    version: env.APP_VERSION || 'dev',
    port: Number(env.PORT ?? 8080) || 8080,
    errorRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0,
    latencyMs: Number.isFinite(latency) ? Math.max(latency, 0) : 0,
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** The request handler; `random` is injectable so tests can force a fault. */
export function handler(settings, random = Math.random) {
  return (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://demo.local');
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (pathname === '/health') return send(res, 200, { status: 'ok', version: settings.version });
    if (pathname !== '/') return send(res, 404, { error: 'not found' });
    setTimeout(() => {
      if (random() < settings.errorRate) {
        return send(res, 500, { error: 'injected fault', version: settings.version });
      }
      send(res, 200, { message: 'Hello from the ForgeFlow demo app', version: settings.version });
    }, settings.latencyMs);
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const settings = settingsFrom(process.env);
  const server = createServer(handler(settings));
  server.listen(settings.port, () => {
    console.log(JSON.stringify({ msg: 'listening', port: settings.port, ...settings }));
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
