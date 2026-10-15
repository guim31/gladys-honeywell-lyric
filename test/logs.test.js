// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the secret, a token or a code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OAUTH_FIELD } from '../src/config.js';
import { CONSUMER_SECRET } from './helpers/fakeResideo.js';
import { CONFIG, createWorld, setValue } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => /connected \(3 thermostat/.test(text)),
    'the start is logged',
  );
  logs.clear();
  const t6 = w.resideo.locations[0].devices[0];
  for (let i = 0; i < 8; i += 1) {
    t6.indoorTemperature += 0.5;
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
  }
  // The access token expired meanwhile: the refresh is silent too.
  assert.ok(w.resideo.count('/oauth2/token') >= 1);
  assert.deepEqual(logs.texts(), []);
});

test('a user command writes one line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  await setValue(w, 'heat_setpoint', 20);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /Hallway: heating setpoint set to 20 °C/);
});

test('a cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.resideo.online = false;
  for (let i = 0; i < 5; i += 1) {
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.resideo.online = true;
  await w.hub.refresh();
  await w.hub.refresh();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /connection restored/);
});

test('the quota reached is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.resideo.rateLimited = true;
  for (let i = 0; i < 4; i += 1) {
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /quota/);
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  const t6 = w.resideo.locations[0].devices[0];
  for (let i = 0; i < 4; i += 1) {
    t6.indoorTemperature += 1;
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('LOG_LEVEL=debug shows each problem; never the secret, a token or a code', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, {
    signIn: false,
    config: { ...CONFIG, callback_url: 'https://localhost/' },
  });
  const ack = await w.fake.oauthAuthorizeUrl(OAUTH_FIELD, 'https://gladys.example/cb');
  const state = new URL(ack.data.authorize_url).searchParams.get('state');
  const code = w.resideo.grantCode('https://localhost/');
  await w.fake.action('paste_code', { code: `https://localhost/?code=${code}&state=${state}` });
  await w.fake.action('paste_code', { code: 'code-refused-123' });
  w.clock.advance(60 * 60_000);
  await w.hub.refresh();
  w.resideo.online = false;
  await w.hub.refresh();
  await w.hub.refresh();
  w.resideo.online = true;
  w.resideo.refreshTokens.clear();
  w.resideo.accessTokens.clear();
  await w.hub.refresh();

  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\]/);
  assert.match(text, /Signed in to Resideo/);
  const secrets = [
    CONSUMER_SECRET,
    code,
    'code-refused-123',
    state,
    ...w.resideo.refreshTokens,
    ...w.resideo.accessTokens.keys(),
    ...[...w.resideo.requests]
      .map((request) => new URLSearchParams(request.body ?? '').get('refresh_token'))
      .filter(Boolean),
  ];
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `"${secret}" must not be logged`);
  }
  assert.ok(!/access-\d|refresh-\d/.test(text), 'no token in the logs');
  assert.ok(!text.includes('apikey='), 'no URL carrying the key');
});
