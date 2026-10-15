// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, an in-memory Resideo API, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the cloud with `world.hub.refresh()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { fingerprint } from '../../src/resideo/client.js';
import { TokenStore } from '../../src/store.js';
import { CONSUMER_KEY, CONSUMER_SECRET, FakeResideo } from './fakeResideo.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const CONFIG = {
  consumer_key: CONSUMER_KEY,
  consumer_secret: CONSUMER_SECRET,
  language: 'en',
};

/** A manual clock, shared by the hub and the fake API. */
export function createClock(start = Date.UTC(2026, 9, 15, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Save tokens the fake API knows, as a previous sign-in would have. */
export async function signedIn(tokens, resideo, clock) {
  const issued = resideo.issueTokens();
  await tokens.save({
    app: fingerprint(CONSUMER_KEY),
    accessToken: issued.access_token,
    refreshToken: issued.refresh_token,
    expiresAt: clock.now() + Number(issued.expires_in) * 1000,
  });
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {boolean} [options.signIn] start with saved tokens (default true)
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  resideo,
  config = CONFIG,
  signIn = true,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-lyric-')),
  timings = {},
  timers = false,
} = {}) {
  const api = resideo ?? new FakeResideo({ now: clock.now });
  const tokens = new TokenStore(dataDir);
  if (signIn) {
    await signedIn(tokens, api, clock);
  }
  const gladys = createFakeGladys({ config, devices });
  const sleeps = [];
  const app = registerHandlers(gladys, {
    tokens,
    request: api.request,
    timers,
    timings,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    resideo: api,
    app,
    hub: app.hub,
    clock,
    dataDir,
    tokens,
    sleeps,
  };
}

export const T6 = '00A01AB1ABCD';
export const T9 = 'AABBCC000011';
export const ROUND = 'AABBCC000012';

/** External ids of a thermostat (by MAC address). */
export const deviceId = (gladys, mac = T6) => gladys.externalIds('thermostat', mac).device;
export const featureId = (gladys, key, mac = T6) =>
  gladys.externalIds('thermostat', mac).feature(key);

/** The published device of a thermostat. */
export const deviceOf = (world, mac = T6) =>
  world.fake.discoveredDevices.find((device) => device.external_id === deviceId(world.gladys, mac));

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** Run a command of a feature as the dashboard does. */
export function setValue(world, key, value, mac = T6) {
  const device = deviceOf(world, mac);
  const feature = device.features.find((f) => f.external_id === featureId(world.gladys, key, mac));
  return world.fake.setValue(device, feature, value);
}

export { FakeResideo };
