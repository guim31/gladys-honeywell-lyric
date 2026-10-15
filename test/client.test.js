// -----------------------------------------------------------------------------
// The Resideo client (src/resideo/client.js) against the in-memory API: the
// OAuth2 requests, the token refresh, the error kinds, and what reaches /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_KINDS, ResideoClient, fingerprint } from '../src/resideo/client.js';
import { TokenStore } from '../src/store.js';
import { CONSUMER_KEY, CONSUMER_SECRET, FakeResideo } from './helpers/fakeResideo.js';
import { createClock } from './helpers/world.js';

const REDIRECT = 'https://gladys.example/dashboard/integration/device/external/x/oauth-callback';

function setup({ rotateRefresh = true, consumerKey = CONSUMER_KEY } = {}) {
  const clock = createClock();
  const api = new FakeResideo({ now: clock.now, rotateRefresh });
  const dir = mkdtempSync(join(tmpdir(), 'gladys-lyric-client-'));
  const tokens = new TokenStore(dir);
  const client = new ResideoClient({
    consumerKey,
    consumerSecret: CONSUMER_SECRET,
    tokens,
    request: api.request,
    now: clock.now,
  });
  return { clock, api, tokens, client, dir };
}

test('the sign-in page carries the key, the redirect, the state and the app choice', () => {
  const { client } = setup();
  const url = new URL(client.authorizeUrl(REDIRECT, 'state-1'));
  assert.equal(url.origin + url.pathname, 'https://api.honeywellhome.com/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CONSUMER_KEY);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('appSelect'), '1');
});

test('the code is exchanged with Basic auth, and the tokens land in /data, private', async () => {
  const { api, client, tokens, dir } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  await tokens.flush();
  const request = api.requests.at(-1);
  assert.equal(request.path, '/oauth2/token');
  const form = new URLSearchParams(request.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('redirect_uri'), REDIRECT);

  const path = join(dir, 'resideo-tokens.json');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.app, fingerprint(CONSUMER_KEY));
  assert.match(saved.refreshToken, /^refresh-/);
  const text = readFileSync(path, 'utf8');
  assert.ok(!text.includes(CONSUMER_SECRET), 'never the secret');
  assert.ok(!text.includes(CONSUMER_KEY), 'never the key itself');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal((await client.getLocations()).length, 2);
});

test('a code used twice, or for another redirect, is refused as a sign-in problem', async () => {
  const { api, client } = setup();
  const code = api.grantCode(REDIRECT);
  await assert.rejects(client.exchangeCode(code, 'https://other.example/'), {
    kind: ERROR_KINDS.AUTH,
  });
  await assert.rejects(client.exchangeCode('code-unknown', REDIRECT), { kind: ERROR_KINDS.AUTH });
});

test('a wrong secret is refused as a sign-in problem', async () => {
  const { api } = setup();
  const client = new ResideoClient({
    consumerKey: CONSUMER_KEY,
    consumerSecret: 'wrong',
    tokens: new TokenStore(mkdtempSync(join(tmpdir(), 'gladys-lyric-client-'))),
    request: api.request,
  });
  await assert.rejects(client.exchangeCode(api.grantCode(REDIRECT), REDIRECT), {
    kind: ERROR_KINDS.AUTH,
    status: 401,
  });
});

test('an expired access token is refreshed before the call, the new refresh token kept', async () => {
  const { api, clock, client } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  const firstRefresh = client.session.refreshToken;
  clock.advance(29 * 60_000); // within the 2-minute margin of the 1799 s lifetime
  await client.getLocations();
  assert.equal(api.count('/oauth2/token'), 2);
  assert.notEqual(client.session.refreshToken, firstRefresh);
  // The old refresh token is gone at Resideo: the new one must work.
  clock.advance(30 * 60_000);
  await client.getLocations();
  assert.equal(api.count('/oauth2/token'), 3);
});

test('a refresh without a new refresh token keeps the old one', async () => {
  const { api, clock, client } = setup({ rotateRefresh: false });
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  const refresh = client.session.refreshToken;
  clock.advance(60 * 60_000);
  await client.getLocations();
  assert.equal(client.session.refreshToken, refresh);
  clock.advance(60 * 60_000);
  await client.getLocations();
  assert.equal(api.count('/oauth2/token'), 3);
});

test('concurrent calls share one refresh', async () => {
  const { api, clock, client } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  clock.advance(60 * 60_000);
  await Promise.all([client.getLocations(), client.getLocations(), client.getLocations()]);
  assert.equal(api.count('/oauth2/token'), 2);
});

test('a 401 refreshes the token once and retries the call', async () => {
  const { api, client } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  api.accessTokens.clear(); // Resideo forgot the token before its expiry
  assert.equal((await client.getLocations()).length, 2);
  assert.equal(api.count('/v2/locations'), 2);
});

test('a refused refresh token is a sign-in problem', async () => {
  const { api, clock, client } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  api.refreshTokens.clear();
  clock.advance(60 * 60_000);
  await assert.rejects(client.getLocations(), { kind: ERROR_KINDS.AUTH });
});

test('the error kinds: quota, network, refusal', async () => {
  const { api, client } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  api.rateLimited = true;
  await assert.rejects(client.getLocations(), { kind: ERROR_KINDS.RATE_LIMIT, status: 429 });
  api.rateLimited = false;
  api.online = false;
  await assert.rejects(client.getLocations(), { kind: ERROR_KINDS.UNREACHABLE });
  api.online = true;
  api.refuseWrites = true;
  await assert.rejects(client.updateThermostat(123456, 'LCC-00A01AB1ABCD', { mode: 'Heat' }), {
    kind: ERROR_KINDS.REFUSED,
    status: 400,
  });
});

test('no tokens: not connected, without any request', async () => {
  const { api, client } = setup();
  assert.equal(await client.isConnected(), false);
  await assert.rejects(client.getLocations(), { kind: ERROR_KINDS.NOT_CONNECTED });
  assert.equal(api.requests.length, 0);
});

test('the tokens of another developer app are not used', async () => {
  const { api, tokens, client } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  await tokens.flush();
  const other = new ResideoClient({
    consumerKey: 'ANOTHER-KEY',
    consumerSecret: CONSUMER_SECRET,
    tokens,
    request: api.request,
  });
  assert.equal(await other.isConnected(), false);
});

test('the priority of a thermostat without rooms is null, not an error', async () => {
  const { api, client } = setup();
  await client.exchangeCode(api.grantCode(REDIRECT), REDIRECT);
  assert.equal(await client.getPriority(123456, 'LCC-00A01AB1ABCD'), null);
  const priority = await client.getPriority(234567, 'LCC-1f2e3d4c-5b6a-4f11-8a9b-0c1d2e3f4a5b');
  assert.equal(priority.priority.rooms.length, 3);
  const request = api.requests.at(-1);
  assert.equal(request.query.locationId, '234567');
  assert.equal(request.query.apikey, CONSUMER_KEY);
});
