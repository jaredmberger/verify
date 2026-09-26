import base from './entry-v1.1.js';
import { BUILD_META } from './build-meta.generated.js';

const SERVICE = 'Curator Verify';
const VERSION = '1.2.0';
const REPOSITORY = 'jaredmberger/verify';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/recovery-export') {
      const authError = requireRecoveryExportToken(request, env);
      if (authError) return authError;
      return recoveryExport(env);
    }
    if (request.method === 'GET' && url.pathname === '/api/runtime') {
      const meta = env.CF_VERSION_METADATA || {};
      return json({
        ok: true,
        service: SERVICE,
        version: VERSION,
        repository: REPOSITORY,
        runtime: 'cloudflare-workers',
        build: {
          commit: BUILD_META.commit,
          branch: BUILD_META.branch,
          buildUuid: BUILD_META.buildUuid,
          source: BUILD_META.source
        },
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

function requireRecoveryExportToken(request, env) {
  if (!env.RECOVERY_EXPORT_TOKEN) {
    return json({ ok: false, error: 'Recovery export is disabled because RECOVERY_EXPORT_TOKEN is not configured.' }, 503);
  }
  const supplied = request.headers.get('x-curator-recovery-key');
  return supplied === env.RECOVERY_EXPORT_TOKEN
    ? null
    : json({ ok: false, error: 'Unauthorized recovery export request.' }, 401);
}

async function recoveryExport(env) {
  if (!env.CURATOR_VERIFY_RECORDS) {
    return json({ ok: false, error: 'CURATOR_VERIFY_RECORDS is not configured.' }, 500);
  }
  try {
    const entries = [];
    let cursor;
    do {
      const page = await env.CURATOR_VERIFY_RECORDS.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const item of page.keys) {
        const raw = await env.CURATOR_VERIFY_RECORDS.get(item.name, 'text');
        if (raw === null) throw new Error(`Listed KV key disappeared during export: ${item.name}`);
        entries.push({ key: item.name, value: raw });
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    entries.sort((a, b) => a.key.localeCompare(b.key));
    const data = { entries };
    const exportedAt = new Date().toISOString();
    const dataSha256 = await sha256(JSON.stringify(data));
    const payload = {
      format: 'curator-verify-kv-recovery',
      schemaVersion: 1,
      exportedAt,
      source: {
        service: SERVICE,
        binding: 'CURATOR_VERIFY_RECORDS',
        namespaceId: 'bf7fb04aa1754f729acd62595bf21004'
      },
      integrity: { algorithm: 'SHA-256', dataSha256 },
      summary: { keyCount: entries.length },
      data
    };
    const stamp = exportedAt.replace(/[:.]/g, '-');
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="curator-verify-recovery-${stamp}.json"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex, nofollow, noarchive'
      }
    });
  } catch (error) {
    return json({ ok: false, error: 'Recovery export failed.', detail: error?.message || String(error) }, 500);
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
