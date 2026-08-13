import base from './index.js';

const SERVICE = 'Curator Verify';
const VERSION = '1.1.0';
const REPOSITORY = 'jaredmberger/verify';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/runtime') {
      const meta = env.CF_VERSION_METADATA || {};
      return json({
        ok: true,
        service: SERVICE,
        version: VERSION,
        repository: REPOSITORY,
        runtime: 'cloudflare-workers',
        cloudflareVersion: {
          id: meta.id || null,
          tag: meta.tag || null,
          timestamp: meta.timestamp || null
        },
        observedAt: new Date().toISOString()
      });
    }
    return base.fetch(request, env, ctx);
  }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}
