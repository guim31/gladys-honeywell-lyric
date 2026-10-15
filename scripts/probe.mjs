#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Resideo API with FAKE credentials, read-only: runs the
// sign-in of the integration until Resideo refuses it, and prints what each
// endpoint answers (status, error code, shape), never a body that could hold
// something personal. Run it from a machine that reaches api.honeywellhome.com:
//
//   node scripts/probe.mjs
//
// It checks the assumptions the integration was built on without hardware:
// the authorize page exists, the token endpoint takes Basic auth and refuses
// a fake app with 401, the v2 API refuses a fake key and token, and the
// client of the integration turns those answers into the right error kinds.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_URL, ResideoClient } from '../src/resideo/client.js';
import { TokenStore } from '../src/store.js';

const FAKE_KEY = 'gladys-probe-fake-key';
const FAKE_SECRET = 'gladys-probe-fake-secret';
const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';

const results = [];

/** Only the keys of an object, nested one level: the shape, not the values. */
function shape(text) {
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object') {
      return typeof body;
    }
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [
        key,
        value && typeof value === 'object' ? Object.keys(value) : typeof value,
      ]),
    );
  } catch {
    return text ? `non-JSON (${text.length} bytes)` : 'empty';
  }
}

/** The error code of an answer (Apigee fault or OAuth error), safe to print. */
function code(text) {
  try {
    const body = JSON.parse(text);
    return body?.fault?.detail?.errorcode ?? body?.error ?? body?.ErrorCode ?? body?.code ?? null;
  } catch {
    return null;
  }
}

async function step(name, run) {
  try {
    const result = await run();
    results.push({ step: name, ...result });
  } catch (err) {
    results.push({
      step: name,
      error: err.name,
      kind: err.kind,
      status: err.status,
      code: err.code,
      message: err.message,
    });
  }
}

await step('authorize page', async () => {
  const url = new ResideoClient({
    consumerKey: FAKE_KEY,
    consumerSecret: FAKE_SECRET,
    tokens: null,
  }).authorizeUrl(REDIRECT, 'probe-state');
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const location = response.headers.get('location');
  return {
    status: response.status,
    redirectsTo: location ? new URL(location, url).host : null,
    contentType: response.headers.get('content-type'),
  };
});

for (const [name, form] of [
  [
    'token, authorization code',
    { grant_type: 'authorization_code', code: 'fake-code', redirect_uri: REDIRECT },
  ],
  ['token, refresh token', { grant_type: 'refresh_token', refresh_token: 'fake-refresh-token' }],
]) {
  await step(name, async () => {
    const response = await fetch(`${BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${FAKE_KEY}:${FAKE_SECRET}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    return { status: response.status, code: code(text), shape: shape(text) };
  });
}

await step('GET /v2/locations with a fake key and token', async () => {
  const response = await fetch(`${BASE_URL}/v2/locations?apikey=${FAKE_KEY}`, {
    headers: { authorization: 'Bearer fake-access-token', accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  return { status: response.status, code: code(text), shape: shape(text) };
});

// The client of the integration, end to end: the code exchange must fail as
// a sign-in problem (kind "auth"), not as "unreachable".
const dir = mkdtempSync(join(tmpdir(), 'lyric-probe-'));
await step('integration client: exchange a fake code', async () => {
  const client = new ResideoClient({
    consumerKey: FAKE_KEY,
    consumerSecret: FAKE_SECRET,
    tokens: new TokenStore(dir),
  });
  await client.exchangeCode('fake-code', REDIRECT);
  return { unexpected: 'the fake code was accepted' };
});
rmSync(dir, { recursive: true, force: true });

for (const result of results) {
  console.log(JSON.stringify(result));
}
const client = results.at(-1);
const ok = client.kind === 'auth';
console.log(
  ok
    ? 'OK: Resideo refuses the fake app as a sign-in problem, as the integration expects.'
    : 'CHECK: the answers differ from what the integration expects, see above.',
);
process.exitCode = ok ? 0 : 1;
