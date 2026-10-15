// -----------------------------------------------------------------------------
// Scene actions (src/scenes.js), run like the Gladys scene engine does: with
// the resolved fields, the declared outputs back.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTemperature } from '../src/hub.js';
import { ROUND, T6, T9, createWorld, deviceId, featureId } from './helpers/world.js';

async function world(t) {
  const w = await createWorld();
  t.after(() => w.app.stop());
  return w;
}

test('resume the schedule of every thermostat that has one', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('resume_schedule', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    ack.data.outputs,
    { count: 2 },
    'the T6 and the T9; the Round has no schedule hold',
  );
  assert.deepEqual(
    w.resideo.writes.map((write) => [write.deviceId, write.body.thermostatSetpointStatus]),
    [
      ['LCC-00A01AB1ABCD', 'NoHold'],
      ['LCC-1f2e3d4c-5b6a-4f11-8a9b-0c1d2e3f4a5b', 'NoHold'],
    ],
  );
  assert.equal(w.fake.lastState(featureId(w.gladys, 'hold', T9)), 'schedule');
});

test('resume the schedule of one thermostat', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('resume_schedule', { device: deviceId(w.gladys, T9) });
  assert.deepEqual(ack.data.outputs, { count: 1 });
  assert.equal(w.resideo.writes.length, 1);
  const round = await w.fake.sceneAction('resume_schedule', { device: deviceId(w.gladys, ROUND) });
  assert.deepEqual(round.data.outputs, { count: 0 });
});

test('hold a temperature permanently, typed with a comma', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('hold_temperature', {
    device: deviceId(w.gladys, T6),
    temperature: '19,3',
    hold: 'permanent',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { setpoint: 19.5 });
  const { body } = w.resideo.writes.at(-1);
  assert.equal(body.heatSetpoint, 19.5);
  assert.equal(body.thermostatSetpointStatus, 'PermanentHold');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'hold')), 'permanent');
});

test('hold a temperature: until the next period by default', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('hold_temperature', {
    device: deviceId(w.gladys, T6),
    temperature: 18,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.resideo.writes.at(-1).body.thermostatSetpointStatus, 'TemporaryHold');
});

test('hold a temperature: the cooling setpoint when the thermostat cools', async (t) => {
  const w = await world(t);
  const t9 = w.resideo.locations[1].devices[0];
  t9.changeableValues.mode = 'Cool';
  await w.hub.refresh();
  const ack = await w.fake.sceneAction('hold_temperature', {
    device: deviceId(w.gladys, T9),
    temperature: '74',
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.resideo.writes.at(-1).body.coolSetpoint, 74);
});

test('hold a temperature: refusals say why', async (t) => {
  const w = await world(t);
  const noDevice = await w.fake.sceneAction('hold_temperature', { temperature: '19' });
  assert.equal(noDevice.success, false);
  assert.match(noDevice.error, /Choose a thermostat/);
  const garbage = await w.fake.sceneAction('hold_temperature', {
    device: deviceId(w.gladys, T6),
    temperature: 'warm',
  });
  assert.match(garbage.error, /not understood/);
  const off = await w.fake.sceneAction('hold_temperature', {
    device: deviceId(w.gladys, ROUND),
    temperature: '70',
  });
  assert.match(off.error, /off/);
  const unknown = await w.fake.sceneAction('hold_temperature', {
    device: 'ext:test-integration:thermostat:FFFFFFFFFFFF',
    temperature: '19',
  });
  assert.match(unknown.error, /Unknown thermostat/);
  assert.equal(w.resideo.writes.length, 0);
});

test('a temperature typed in a scene', () => {
  assert.equal(parseTemperature('19,5'), 19.5);
  assert.equal(parseTemperature(' 20 '), 20);
  assert.equal(parseTemperature(21), 21);
  assert.equal(parseTemperature(''), null);
  assert.equal(parseTemperature('abc'), null);
  assert.equal(parseTemperature(Number.NaN), null);
  assert.equal(parseTemperature(undefined), null);
});
