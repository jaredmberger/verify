const KV = 'CURATOR_VERIFY_RECORDS';
const RECORD_PREFIX = 'verification:';
const LATEST_PREFIX = 'latest:';
const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 12000;

const ALLOWED_HOSTS = [
  'oceanliners.net',
  'www.oceanliners.net'
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return htmlResponse(renderHome());
    }

    if (request.method === 'GET' && url.pathname === '/api/status') {
      return json({
        ok: true,
        service: 'Curator Verify',
        version: '1.0.0',
        role: 'Independent verification layer',
        kvConfigured: Boolean(env[KV]),
        allowedTargets: ['oceanliners.net', '*.oceanliners.net'],
        timestamp: new Date().toISOString()
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/recent') {
      requireKv(env);
      const limit = clampInt(url.searchParams.get('limit'), 1, 50, 20);
      const listed = await env[KV].list({ prefix: RECORD_PREFIX, limit });
      const rows = [];
      for (const key of listed.keys) {
        const record = await env[KV].get(key.name, 'json');
        if (record) rows.push(record);
      }
      rows.sort((a, b) => Date.parse(b.checkedAt || 0) - Date.parse(a.checkedAt || 0));
      return json({ ok: true, count: rows.length, results: rows });
    }

    if (request.method === 'POST' && url.pathname === '/api/verify') {
      if (!env.VERIFY_WRITE_KEY) {
        return json({ ok: false, error: 'VERIFY_WRITE_KEY secret is not configured.' }, 503);
      }
      const supplied = request.headers.get('x-curator-verify-key') || '';
      if (!safeEqual(supplied, env.VERIFY_WRITE_KEY)) {
        return json({ ok: false, error: 'Unauthorized.' }, 401);
      }

      requireKv(env);
      let input;
      try {
        input = await request.json();
      } catch {
        return json({ ok: false, error: 'Expected a JSON request body.' }, 400);
      }

      const validation = validateRequest(input);
      if (!validation.ok) return json({ ok: false, error: validation.error }, 400);

      const record = await verifyTarget(validation.value);
      await persistRecord(env, record);
      return json({ ok: true, verification: record }, 200);
    }

    return json({ ok: false, error: 'Not found.' }, 404);
  }
};

function validateRequest(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Request body must be an object.' };
  if (typeof input.url !== 'string' || !input.url.trim()) return { ok: false, error: 'url is required.' };

  let target;
  try {
    target = new URL(input.url);
  } catch {
    return { ok: false, error: 'url must be a valid absolute URL.' };
  }

  if (target.protocol !== 'https:') return { ok: false, error: 'Only https targets are allowed.' };
  if (!isAllowedHost(target.hostname)) return { ok: false, error: 'Target must be oceanliners.net or one of its subdomains.' };
  if (target.username || target.password) return { ok: false, error: 'Credentials in URLs are not allowed.' };

  const expectedStatus = input.expectedStatus == null ? null : Number(input.expectedStatus);
  if (expectedStatus != null && (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599)) {
    return { ok: false, error: 'expectedStatus must be an HTTP status code.' };
  }

  const contains = input.contains == null ? null : String(input.contains).slice(0, 500);
  const claim = ['reachable', 'unreachable', 'status', 'content'].includes(input.claim) ? input.claim : 'reachable';

  return {
    ok: true,
    value: {
      url: target.toString(),
      expectedStatus,
      contains,
      claim,
      source: sanitizeLabel(input.source || 'unspecified'),
      incidentId: sanitizeLabel(input.incidentId || ''),
      note: typeof input.note === 'string' ? input.note.slice(0, 500) : ''
    }
  };
}

async function verifyTarget(input) {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  let response = null;
  let body = '';
  let error = null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('verification timeout'), REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(input.url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        'user-agent': 'CuratorVerify/1.0 (+https://verify.oceanlinercurator.com)',
        'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    const reader = response.body?.getReader();
    if (reader) {
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) break;
        chunks.push(value);
      }
      const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = new TextDecoder().decode(merged);
    }
  } catch (err) {
    error = String(err?.message || err || 'fetch failed').slice(0, 500);
  } finally {
    clearTimeout(timeout);
  }

  const evidence = {
    fetchSucceeded: Boolean(response),
    status: response?.status ?? null,
    ok: response?.ok ?? false,
    finalUrl: response?.url || null,
    contentType: response?.headers.get('content-type') || null,
    bodyBytesRead: new TextEncoder().encode(body).byteLength,
    containsMatched: input.contains ? body.includes(input.contains) : null,
    error,
    durationMs: Date.now() - startedAt
  };

  const verdict = decideVerdict(input, evidence);
  const id = crypto.randomUUID();

  return {
    id,
    checkedAt,
    verdict,
    target: input.url,
    claim: input.claim,
    expectedStatus: input.expectedStatus,
    contains: input.contains,
    source: input.source,
    incidentId: input.incidentId || null,
    note: input.note || null,
    evidence
  };
}

function decideVerdict(input, evidence) {
  if (input.claim === 'unreachable') {
    return evidence.fetchSucceeded ? 'not_confirmed' : 'confirmed';
  }

  if (!evidence.fetchSucceeded) return input.claim === 'reachable' ? 'not_confirmed' : 'inconclusive';

  if (input.expectedStatus != null && evidence.status !== input.expectedStatus) return 'not_confirmed';
  if (input.contains && evidence.containsMatched !== true) return 'not_confirmed';

  if (input.claim === 'status' || input.claim === 'content' || input.claim === 'reachable') {
    return evidence.ok ? 'confirmed' : 'not_confirmed';
  }

  return 'inconclusive';
}

async function persistRecord(env, record) {
  const ts = Date.parse(record.checkedAt) || Date.now();
  const key = `${RECORD_PREFIX}${String(9999999999999 - ts).padStart(13, '0')}:${record.id}`;
  await env[KV].put(key, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 180 });

  const hash = await shortHash(record.target);
  await env[KV].put(`${LATEST_PREFIX}${hash}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 30 });
}

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  if (ALLOWED_HOSTS.includes(host)) return true;
  return host.endsWith('.oceanliners.net');
}

function sanitizeLabel(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._:/-]/g, '').slice(0, 120);
}

function requireKv(env) {
  if (!env[KV]) throw new Error(`${KV} KV binding is not configured.`);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function shortHash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 10).map(v => v.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function renderHome() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Curator Verify</title>
<style>
:root{color-scheme:dark;--bg:#0a1110;--panel:#101918;--brass:#bfa46a;--text:#f3eee3;--muted:#a8b0ab;--line:#263330}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#17221f 0,#0a1110 52%);color:var(--text);font-family:Georgia,'Times New Roman',serif;min-height:100vh}.wrap{max-width:820px;margin:0 auto;padding:72px 22px}.eyebrow{font:600 12px system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--brass)}h1{font-size:clamp(36px,8vw,66px);font-weight:400;margin:.25em 0 .15em}.lede{font-size:19px;line-height:1.65;color:#d7d4cb;max-width:680px}.card{margin-top:38px;border:1px solid var(--line);background:rgba(16,25,24,.82);border-radius:18px;padding:24px;box-shadow:0 20px 55px rgba(0,0,0,.22)}.status{display:flex;gap:12px;align-items:center;font:600 14px system-ui,sans-serif}.dot{width:10px;height:10px;border-radius:50%;background:#58c77a;box-shadow:0 0 14px rgba(88,199,122,.6)}dl{display:grid;grid-template-columns:140px 1fr;gap:12px;margin:26px 0 0;font:14px/1.55 system-ui,sans-serif}dt{color:var(--muted)}dd{margin:0}code{color:#e9d49e}footer{margin-top:42px;color:#707a75;font:12px system-ui,sans-serif}</style>
</head>
<body><main class="wrap"><div class="eyebrow">CuratorOS · Independent Evidence</div><h1>Curator Verify</h1><p class="lede">A deliberately small second observer. Verify does not discover incidents and does not decide priorities. It independently tests a claimed condition and returns evidence.</p><section class="card"><div class="status"><span class="dot"></span> Verification service online</div><dl><dt>Role</dt><dd>Confirm or reject observations from CuratorOS specialist tools.</dd><dt>Verdicts</dt><dd><code>confirmed</code> · <code>not_confirmed</code> · <code>inconclusive</code></dd><dt>Scope</dt><dd><code>oceanliners.net</code> and its subdomains only.</dd><dt>Status API</dt><dd><code>/api/status</code></dd><dt>Verification API</dt><dd><code>POST /api/verify</code></dd></dl></section><footer>Ocean Liner Curator · CuratorOS Verification Layer</footer></main></body></html>`;
}
