// -----------------------------------------------------------------------------
// Signing in to Resideo: the "Connect" button relayed by Gladys (oauth2 field)
// and its fallback, the code pasted from the browser address bar.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { parsePastedCode, unwrapState } from '../src/hub.js';
import { OAUTH_FIELD } from '../src/config.js';
import { CONFIG, createWorld } from './helpers/world.js';

// The HTTPS page Gladys (4.85+) declares as redirect URI, which bounces the
// browser back to the instance (front/src/utils/oauth.js).
const GLADYS_REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';
const MANUAL = 'https://localhost/';

async function world(t, options = {}) {
  const w = await createWorld({ signIn: false, ...options });
  t.after(() => w.app.stop());
  return w;
}

test('Connect: the sign-in page comes back to Gladys, the code is exchanged, the thermostats read', async (t) => {
  const w = await world(t);
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  assert.equal(ack.success, true, ack.error);
  const url = new URL(ack.data.authorize_url);
  assert.equal(url.searchParams.get('redirect_uri'), GLADYS_REDIRECT);
  const state = url.searchParams.get('state');
  assert.ok(state);

  const code = w.resideo.grantCode(GLADYS_REDIRECT);
  const callback = await w.fake.oauthCallback(OAUTH_FIELD, {
    code,
    state,
    redirectUri: GLADYS_REDIRECT,
  });
  assert.equal(callback.success, true, callback.error);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.discoveredDevices.length, 3);
  assert.deepEqual(readdirSync(w.dataDir), ['resideo-tokens.json']);
});

test('Connect: a callback with another state is refused', async (t) => {
  const w = await world(t);
  await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const ack = await w.fake.oauthCallback(OAUTH_FIELD, {
    code: w.resideo.grantCode(GLADYS_REDIRECT),
    state: 'forged',
    redirectUri: GLADYS_REDIRECT,
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Connect/);
  assert.equal(w.resideo.count('/oauth2/token'), 0);
});

test('Connect: a sign-in started too long ago is refused', async (t) => {
  const w = await world(t);
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const state = new URL(ack.data.authorize_url).searchParams.get('state');
  w.clock.advance(31 * 60_000);
  const callback = await w.fake.oauthCallback(OAUTH_FIELD, {
    code: w.resideo.grantCode(GLADYS_REDIRECT),
    state,
    redirectUri: GLADYS_REDIRECT,
  });
  assert.equal(callback.success, false);
});

test('Connect without the key and secret says what to fill in', async (t) => {
  const w = await world(t, { config: { language: 'es' } });
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  assert.equal(ack.success, false);
  assert.match(ack.error, /clave/);
});

test('a refused code tells it is single-use', async (t) => {
  const w = await world(t);
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const state = new URL(ack.data.authorize_url).searchParams.get('state');
  const callback = await w.fake.oauthCallback(OAUTH_FIELD, {
    code: 'code-expired',
    state,
    redirectUri: GLADYS_REDIRECT,
  });
  assert.equal(callback.success, false);
  assert.match(callback.error, /only once/);
});

test('pasted code: Connect uses the typed callback URL, the whole address is pasted', async (t) => {
  const w = await world(t, { config: { ...CONFIG, callback_url: MANUAL } });
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const url = new URL(ack.data.authorize_url);
  assert.equal(url.searchParams.get('redirect_uri'), MANUAL);
  const state = url.searchParams.get('state');

  const code = w.resideo.grantCode(MANUAL);
  const pasted = await w.fake.action('paste_code', {
    code: `  ${MANUAL}?code=${code}&state=${state}  `,
  });
  assert.equal(pasted.success, true, pasted.error);
  assert.equal(pasted.data.message.en, 'Connected to Resideo: 3 thermostat(s).');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('pasted code: the code alone works too; a stale state is refused', async (t) => {
  const w = await world(t, { config: { ...CONFIG, callback_url: MANUAL } });
  await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const stale = await w.fake.action('paste_code', {
    code: `${MANUAL}?code=${w.resideo.grantCode(MANUAL)}&state=old`,
  });
  assert.equal(stale.success, false);
  const ack = await w.fake.action('paste_code', { code: w.resideo.grantCode(MANUAL) });
  assert.equal(ack.success, true, ack.error);
});

test('pasted code: without a callback URL, or without a code, the action says why', async (t) => {
  const w = await world(t);
  const noCallback = await w.fake.action('paste_code', { code: 'abc' });
  assert.equal(noCallback.success, false);
  assert.match(noCallback.error, /callback URL/);

  await w.fake.configUpdated({ ...CONFIG, callback_url: MANUAL });
  const empty = await w.fake.action('paste_code', {});
  assert.equal(empty.success, false);
  assert.match(empty.error, /No authorization code/);
});

test('an unusable callback URL is reported, Connect falls back to Gladys', async (t) => {
  const w = await world(t, { config: { ...CONFIG, callback_url: 'localhost' } });
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  assert.equal(new URL(ack.data.authorize_url).searchParams.get('redirect_uri'), GLADYS_REDIRECT);
  const test = await w.fake.action('test_connection', {});
  assert.equal(test.success, false);
  assert.match(test.error, /https/);
});

/** The state as the Gladys front hands it to the provider. */
const wrap = (state) =>
  Buffer.from(
    JSON.stringify({
      v: 1,
      origin: 'http://192.0.2.10',
      path: '/dashboard/integration/device/external/test-integration/oauth-callback',
      state,
    }),
  ).toString('base64url');

test('pasted code: the state wrapped by the Gladys front is recognized', async (t) => {
  const w = await world(t, { config: { ...CONFIG, callback_url: MANUAL } });
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const state = new URL(ack.data.authorize_url).searchParams.get('state');
  const pasted = await w.fake.action('paste_code', {
    code: `${MANUAL}?code=${w.resideo.grantCode(MANUAL)}&state=${wrap(state)}`,
  });
  assert.equal(pasted.success, true, pasted.error);
});

test('unwrapping a state', () => {
  assert.equal(unwrapState(wrap('abc')), 'abc');
  assert.equal(unwrapState('plain-state'), 'plain-state');
  assert.equal(unwrapState(''), null);
  assert.equal(unwrapState(null), null);
});

test('what a pasted text holds', () => {
  assert.deepEqual(parsePastedCode('https://localhost/?code=abc-1&state=s'), {
    code: 'abc-1',
    state: 's',
  });
  assert.deepEqual(parsePastedCode('?code=abc'), { code: 'abc', state: null });
  assert.deepEqual(parsePastedCode(' abc.DEF_9~ '), { code: 'abc.DEF_9~', state: null });
  assert.equal(parsePastedCode('two words'), null);
  assert.equal(parsePastedCode(''), null);
  assert.equal(parsePastedCode(undefined), null);
});
