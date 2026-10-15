// -----------------------------------------------------------------------------
// The hub through the very same wiring as production (registerHandlers on the
// SDK's fake Gladys), against the in-memory Resideo API: what Gladys receives,
// what Resideo receives, and the scene events.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  ROUND,
  T6,
  T9,
  createAll,
  createWorld,
  deviceId,
  deviceOf,
  featureId,
  setValue,
} from './helpers/world.js';
import { TRIGGERS } from '../src/hub.js';
import { THERMOSTAT_MODE } from '../src/resideo/model.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const lastWrite = (w) => w.resideo.writes.at(-1);

test('every thermostat of every location is a device, with its states and a cloud badge', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Hallway', 'Living room', 'Landing'],
  );
  assert.equal(w.fake.lastState(featureId(w.gladys, 'temperature')), 23.5);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'heat_setpoint')), 15);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'mode')), THERMOSTAT_MODE.HEATING);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'hold')), 'schedule');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'mode', T9)), THERMOSTAT_MODE.AUTO);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'operating_state', T9)), 2);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'cool_setpoint', ROUND)), 76);
  assert.deepEqual(
    w.fake.transports.map((entry) => entry.transport),
    ['cloud', 'cloud', 'cloud'],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the room sensors of a T9 are features of the thermostat', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'room_1_temperature', T9)), 76);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'room_1_humidity', T9)), 52);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'room_1_presence', T9)), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'room_2_presence', T9)), 0);
  const names = deviceOf(w, T9).features.map((feature) => feature.name);
  assert.ok(names.includes('Office temperature'));
  assert.ok(!names.some((name) => name.startsWith('Hallway')), 'the thermostat room is left out');
});

test('a thermostat without room data is not asked again', async (t) => {
  const w = await world(t);
  const priorityCalls = () =>
    w.resideo.requests.filter((r) => r.path.endsWith('/priority') && r.path.includes('LCC-00A0'))
      .length;
  assert.equal(priorityCalls(), 1);
  await w.hub.refresh();
  await w.hub.refresh();
  assert.equal(priorityCalls(), 1);
  // One reading: the locations, and the priority of the T9 only.
  const before = w.resideo.requests.length;
  await w.hub.refresh();
  assert.equal(w.resideo.requests.length - before, 2);
});

test('a room temperature change is published, an unchanged reading publishes nothing', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.hub.refresh();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');
  w.resideo.priorities[
    'LCC-1f2e3d4c-5b6a-4f11-8a9b-0c1d2e3f4a5b'
  ].priority.rooms[1].avgTemperature = 78;
  await w.hub.refresh();
  assert.equal(w.fake.states.length, before + 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'room_1_temperature', T9)), 78);
});

test('a heating setpoint is rounded, sent as a temporary hold, published at once', async (t) => {
  const w = await world(t);
  const ack = await setValue(w, 'heat_setpoint', 20.3);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(lastWrite(w), {
    deviceId: 'LCC-00A01AB1ABCD',
    body: {
      mode: 'Heat',
      heatSetpoint: 20.5,
      coolSetpoint: 28,
      autoChangeoverActive: false,
      thermostatSetpointStatus: 'TemporaryHold',
    },
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'heat_setpoint')), 20.5);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'hold')), 'temporary');
  // The write went to the location of the thermostat.
  const request = w.resideo.requests.at(-1);
  assert.equal(request.query.locationId, '123456');
});

test('a setpoint beyond the bounds of the thermostat is brought back inside', async (t) => {
  const w = await world(t);
  await setValue(w, 'heat_setpoint', 40);
  assert.equal(lastWrite(w).body.heatSetpoint, 35);
  await setValue(w, 'cool_setpoint', 120.4, T9);
  assert.equal(lastWrite(w).body.coolSetpoint, 99);
});

test('a setpoint is refused while the thermostat is off', async (t) => {
  const w = await world(t);
  const ack = await setValue(w, 'heat_setpoint', 70, ROUND);
  assert.equal(ack.success, false);
  assert.match(ack.error, /off/);
  assert.equal(w.resideo.writes.length, 0);
});

test('in auto mode, the setpoints keep the deadband apart', async (t) => {
  const w = await world(t);
  const refused = await setValue(w, 'heat_setpoint', 74, T9);
  assert.equal(refused.success, false);
  assert.match(refused.error, /3°/);
  const accepted = await setValue(w, 'heat_setpoint', 73, T9);
  assert.equal(accepted.success, true, accepted.error);
  // A permanent hold stays permanent.
  assert.equal(lastWrite(w).body.thermostatSetpointStatus, 'PermanentHold');
});

test('the mode: the thermostat value, refused when not offered', async (t) => {
  const w = await world(t);
  assert.equal((await setValue(w, 'mode', THERMOSTAT_MODE.OFF)).success, true);
  assert.equal(lastWrite(w).body.mode, 'Off');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'mode')), THERMOSTAT_MODE.OFF);
  const ack = await setValue(w, 'mode', THERMOSTAT_MODE.COOLING);
  assert.equal(ack.success, false);
  assert.equal(w.resideo.writes.length, 1);
});

test('a Lyric Round turned from off to auto goes through heat, 3 s apart', async (t) => {
  const w = await world(t);
  const ack = await setValue(w, 'mode', THERMOSTAT_MODE.AUTO, ROUND);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    w.resideo.writes.map(({ body }) => [body.mode, body.autoChangeoverActive]),
    [
      ['Heat', false],
      ['Heat', true],
    ],
  );
  assert.deepEqual(w.sleeps, [3000]);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'mode', ROUND)), THERMOSTAT_MODE.AUTO);
});

test('the schedule select: resume, holds; the app-only holds are refused', async (t) => {
  const w = await world(t);
  assert.equal((await setValue(w, 'hold', 'permanent')).success, true);
  assert.equal(lastWrite(w).body.thermostatSetpointStatus, 'PermanentHold');
  assert.equal((await setValue(w, 'hold', 'schedule')).success, true);
  assert.equal(lastWrite(w).body.thermostatSetpointStatus, 'NoHold');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'hold')), 'schedule');
  for (const option of ['hold_until', 'vacation', 'nonsense']) {
    const ack = await setValue(w, 'hold', option);
    assert.equal(ack.success, false, option);
    assert.match(ack.error, /Resideo app/);
  }
  assert.equal(w.resideo.writes.length, 2);
});

test('a command refused by Resideo fails with a message, the states stay true', async (t) => {
  const w = await world(t);
  w.resideo.refuseWrites = true;
  const ack = await setValue(w, 'heat_setpoint', 21);
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'Resideo refused the command.');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'heat_setpoint')), 15);
});

test('a read-only feature cannot be controlled', async (t) => {
  const w = await world(t);
  const ack = await setValue(w, 'temperature', 20);
  assert.equal(ack.success, false);
});

test('adding a device in Gladys sends its states again', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.fake.deviceCreated(deviceOf(w, T6));
  const sent = w.fake.states.slice(before).map((state) => state.device_feature_external_id);
  assert.ok(sent.includes(featureId(w.gladys, 'temperature')));
  assert.ok(sent.every((id) => id.startsWith(deviceId(w.gladys, T6))));
});

test('a thermostat going offline and back fires the triggers once each', async (t) => {
  const w = await world(t);
  await createAll(w);
  const badges = w.fake.transports.length;
  const t6 = w.resideo.locations[0].devices[0];
  t6.isAlive = false;
  await w.hub.refresh();
  await w.hub.refresh();
  t6.isAlive = true;
  await w.hub.refresh();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.OFFLINE, TRIGGERS.ONLINE],
  );
  assert.deepEqual(w.fake.sceneEvents[0].data, { device: deviceId(w.gladys, T6), name: 'Hallway' });
  assert.deepEqual(
    w.fake.transports
      .slice(badges)
      .filter((e) => e.device_external_id === deviceId(w.gladys, T6))
      .map((e) => e.transport),
    ['unreachable', 'cloud'],
  );
});

test('a lost sign-in fires its trigger once and says to connect again', async (t) => {
  const w = await world(t);
  w.resideo.refreshTokens.clear();
  w.resideo.accessTokens.clear();
  await w.hub.refresh();
  await w.hub.refresh();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.AUTH_LOST],
  );
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Connect/);
  assert.ok(w.fake.transports.slice(-3).every((entry) => entry.transport === 'unreachable'));
});

test('the quota: a 429 doubles the interval, a success restores it', async (t) => {
  const w = await world(t);
  w.resideo.rateLimited = true;
  await w.hub.refresh();
  assert.equal(w.hub.pollInterval(), 10 * 60_000);
  await w.hub.refresh();
  await w.hub.refresh();
  await w.hub.refresh();
  assert.equal(w.hub.pollInterval(), 30 * 60_000, 'never slower than 30 min');
  assert.equal(w.fake.connectionStatus.connected, false);
  w.resideo.rateLimited = false;
  await w.hub.refresh();
  assert.equal(w.hub.pollInterval(), 5 * 60_000);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('no key: the status asks for it, nothing is requested', async (t) => {
  const w = await world(t, { config: { language: 'fr' }, signIn: false });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /clé/);
  assert.equal(w.resideo.requests.length, 0);
});

test('a key but no sign-in: the status asks to click Connect', async (t) => {
  const w = await world(t, { signIn: false });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Connect/);
  assert.equal(w.resideo.requests.length, 0);
  assert.deepEqual(w.fake.discoveredDevices, []);
});

test('an account without thermostat is connected, and says so', async (t) => {
  const w = await world(t);
  w.resideo.locations = [
    { locationID: 1, devices: [{ deviceClass: 'LeakDetector', deviceID: 'W1' }] },
  ];
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.match(w.fake.connectionStatus.message.en, /no thermostat/);
});

test('"Test the connection" lists every thermostat', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const lines = ack.data.message.en.split('\n');
  assert.deepEqual(lines, [
    'Hallway: 23.5 °C, Heating',
    'Living room: 72 °F, Auto, 2 room sensor(s)',
    'Landing: 70 °F, Off',
  ]);
  w.resideo.online = false;
  const failed = await w.fake.action('test_connection', {});
  assert.equal(failed.success, false);
  assert.equal(failed.error, 'The Resideo cloud does not answer.');
});

test('a scan reads the cloud and publishes the devices again', async (t) => {
  const w = await world(t);
  const before = w.resideo.count('/v2/locations');
  await w.fake.scanRequest();
  assert.equal(w.resideo.count('/v2/locations'), before + 1);
  assert.equal(w.fake.discoveredDevices.length, 3);
});

test('a new consumer key drops the thermostats and asks to connect again', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...CONFIG, consumer_key: 'ANOTHER-KEY' });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Connect/);
});

test('the language of the configuration names the features', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'de' } });
  const names = deviceOf(w, T9).features.map((feature) => feature.name);
  assert.ok(names.includes('Solltemperatur Heizen'));
  assert.ok(names.includes('Temperatur Office'));
  const mode = deviceOf(w, T9).features.find((feature) => feature.type === 'mode');
  assert.deepEqual(
    mode.supported_options.map((option) => option.label),
    ['Aus', 'Heizen', 'Kühlen', 'Auto'],
  );
});
