// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device published
// with should_poll: false (and does not poll external devices reliably,
// GladysAssistant/Gladys#3198, not fixed in 5.2.1): the thermostats must be
// read by the hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAll, createClock, createWorld, featureId, FakeResideo } from './helpers/world.js';

/** Let the timer callback and the fake API settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function timedWorld(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const resideo = new FakeResideo({ now: clock.now });
  const w = await createWorld({ clock, resideo, timers: true });
  t.after(() => w.app.stop());
  return w;
}

const tick = async (w, t, ms) => {
  w.clock.advance(ms);
  t.mock.timers.tick(ms);
  await settle();
};

test('the internal timer reads the thermostats every 5 minutes without any onPoll', async (t) => {
  const w = await timedWorld(t);
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  for (const device of w.fake.discoveredDevices) {
    assert.equal(device.should_poll, false, 'Gladys is not asked to poll');
    assert.equal(device.poll_frequency, undefined);
  }
  const t6 = w.resideo.locations[0].devices[0];
  const before = w.resideo.count('/v2/locations');
  for (const temperature of [21, 21.5, 22]) {
    t6.indoorTemperature = temperature;
    await tick(w, t, 5 * 60_000);
    assert.equal(w.fake.lastState(featureId(w.gladys, 'temperature')), temperature);
  }
  assert.equal(w.resideo.count('/v2/locations') - before, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('a reading made meanwhile (a command) delays the next timed one', async (t) => {
  const w = await timedWorld(t);
  const before = w.resideo.count('/v2/locations');
  await tick(w, t, 4 * 60_000);
  await w.hub.refresh(); // e.g. the reading after a command
  await tick(w, t, 60_000); // the timer fires, but the last reading is 1 min old
  assert.equal(w.resideo.count('/v2/locations') - before, 1);
  await tick(w, t, 5 * 60_000);
  assert.equal(w.resideo.count('/v2/locations') - before, 2);
});

test('a command is confirmed by one reading 15 s later', async (t) => {
  const w = await timedWorld(t);
  const before = w.resideo.count('/v2/locations');
  const device = w.fake.discoveredDevices[0];
  const feature = device.features.find(
    (f) => f.external_id === featureId(w.gladys, 'heat_setpoint'),
  );
  await w.fake.setValue(device, feature, 19);
  await w.fake.setValue(device, feature, 19.5);
  await tick(w, t, 15_000);
  assert.equal(w.resideo.count('/v2/locations') - before, 1, 'one confirmation for the burst');
});

test('after a 429 the timer waits twice as long', async (t) => {
  const w = await timedWorld(t);
  w.resideo.rateLimited = true;
  await tick(w, t, 5 * 60_000);
  const after429 = w.resideo.count('/v2/locations');
  await tick(w, t, 5 * 60_000);
  assert.equal(w.resideo.count('/v2/locations'), after429, 'no reading 5 min after a 429');
  await tick(w, t, 5 * 60_000);
  assert.equal(w.resideo.count('/v2/locations'), after429 + 1);
});

test('the timer stops with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const before = w.resideo.requests.length;
  await tick(w, t, 60 * 60_000);
  assert.equal(w.resideo.requests.length, before);
});

test('onPoll, if Gladys ever calls it, respects the same pace', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const device = w.fake.discoveredDevices[0];
  const before = w.resideo.count('/v2/locations');
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(w.resideo.count('/v2/locations'), before, 'read less than 5 min ago');
  w.clock.advance(5 * 60_000);
  await w.fake.poll(device);
  assert.equal(w.resideo.count('/v2/locations'), before + 1);
});

test('an unchanged value is sent again after the heartbeat, within 12 hours', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const id = featureId(w.gladys, 'heat_setpoint');
  const count = () => w.fake.states.filter((s) => s.device_feature_external_id === id).length;
  assert.equal(count(), 1);
  w.clock.advance(60 * 60_000);
  await w.hub.refresh();
  assert.equal(count(), 1);
  assert.ok(w.hub.timings.heartbeatMs <= 12 * 60 * 60_000);
  // The SDK dates the heartbeat with Date.now(): mock it past the heartbeat.
  const later = Date.now() + w.hub.timings.heartbeatMs + 1;
  t.mock.method(Date, 'now', () => later);
  await w.hub.refresh();
  assert.equal(count(), 2);
});
