// -----------------------------------------------------------------------------
// What the Resideo payloads mean (src/resideo/model.js), on the real payloads
// of aiolyric and Home Assistant (test/fixtures/resideo/README.md).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLD,
  OPERATING_STATE,
  THERMOSTAT_MODE,
  applyUpdate,
  buildUpdate,
  currentMode,
  fitSetpoint,
  heatBounds,
  coolBounds,
  holdOption,
  isLcc,
  isPriorityUnsupported,
  isThermostat,
  modeWrites,
  operatingState,
  parseRooms,
  platformIdOf,
  readings,
  roomTemperature,
  supportedModes,
  unitOf,
} from '../src/resideo/model.js';
import { fixture } from './helpers/fakeResideo.js';

const t6 = () => fixture('device-t6-celsius');
const t9 = () => fixture('device-t9-fahrenheit');
const round = () => fixture('device-round-tcc');

test('the family, the unit and the identity of each thermostat', () => {
  assert.equal(isLcc(t6()), true);
  assert.equal(isLcc(t9()), true);
  assert.equal(isLcc(round()), false);
  assert.equal(unitOf(t6()), 'celsius');
  assert.equal(unitOf(t9()), 'fahrenheit');
  assert.equal(platformIdOf(t6()), '00A01AB1ABCD');
  // A T9 deviceID is a UUID: the MAC address stays the identity.
  assert.equal(platformIdOf(t9()), 'AABBCC000011');
  assert.equal(isThermostat(t6()), true);
  assert.equal(isThermostat({ ...t6(), deviceClass: 'LeakDetector' }), false);
  assert.equal(isThermostat({ deviceClass: 'Thermostat' }), false);
});

test('the modes offered follow allowedModes; a TCC that heats and cools gets auto', () => {
  const { OFF, HEATING, COOLING, AUTO } = THERMOSTAT_MODE;
  assert.deepEqual(supportedModes(t6()), [OFF, HEATING]);
  assert.deepEqual(supportedModes(t9()), [OFF, HEATING, COOLING, AUTO]);
  assert.deepEqual(supportedModes(round()), [OFF, HEATING, COOLING, AUTO]);
  // An LCC thermostat that does not list Auto does not get it.
  assert.deepEqual(supportedModes({ ...t9(), allowedModes: ['Heat', 'Off', 'Cool'] }), [
    OFF,
    HEATING,
    COOLING,
  ]);
});

test('the current mode: Auto on an LCC, the changeover flag on a TCC', () => {
  assert.equal(currentMode(t6()), THERMOSTAT_MODE.HEATING);
  assert.equal(currentMode(t9()), THERMOSTAT_MODE.AUTO);
  assert.equal(currentMode(round()), THERMOSTAT_MODE.OFF);
  const roundAuto = round();
  roundAuto.changeableValues = {
    ...roundAuto.changeableValues,
    mode: 'Cool',
    autoChangeoverActive: true,
  };
  assert.equal(currentMode(roundAuto), THERMOSTAT_MODE.AUTO);
  // On an LCC, the flag left on after leaving Auto does not mean auto.
  const t9Heat = t9();
  t9Heat.changeableValues.mode = 'Heat';
  assert.equal(currentMode(t9Heat), THERMOSTAT_MODE.HEATING);
  assert.equal(currentMode({ ...t6(), changeableValues: { mode: 'EmergencyHeat' } }), null);
});

test('the equipment state', () => {
  assert.equal(operatingState(t6()), OPERATING_STATE.IDLE);
  assert.equal(operatingState(t9()), OPERATING_STATE.COOLING);
  assert.equal(operatingState({ operationStatus: { mode: 'Heat' } }), OPERATING_STATE.HEATING);
  assert.equal(operatingState({}), null);
});

test('the schedule hold of an LCC thermostat; none on a TCC', () => {
  assert.equal(holdOption(t6()), 'schedule');
  assert.equal(holdOption(t9()), 'permanent');
  assert.equal(holdOption(round()), null);
  const vacation = t6();
  vacation.changeableValues.thermostatSetpointStatus = 'VacationHold';
  assert.equal(holdOption(vacation), 'vacation');
});

test('setpoint bounds: the API ones, a fallback when unusable', () => {
  assert.deepEqual(heatBounds(t6()), [5, 35]);
  assert.deepEqual(heatBounds(t9()), [40, 90]);
  assert.deepEqual(coolBounds(t9()), [50, 99]);
  // A heat-only T6 answers -18/-18 for cooling.
  assert.deepEqual(coolBounds(t6()), [5, 35]);
});

test('a setpoint is rounded to half a degree C, a whole degree F, and bounded', () => {
  assert.equal(fitSetpoint(t6(), 20.3, [5, 35]), 20.5);
  assert.equal(fitSetpoint(t6(), 20.2, [5, 35]), 20);
  assert.equal(fitSetpoint(t6(), 50, [5, 35]), 35);
  assert.equal(fitSetpoint(t9(), 68.6, [40, 90]), 69);
  assert.equal(fitSetpoint(t9(), 10, [40, 90]), 40);
});

test('the readings of a thermostat', () => {
  assert.deepEqual(readings(t6()), {
    temperature: 23.5,
    humidity: 51,
    outdoorTemperature: 16,
    heatSetpoint: 15,
    coolSetpoint: 28,
    mode: THERMOSTAT_MODE.HEATING,
    operatingState: OPERATING_STATE.IDLE,
    hold: 'schedule',
    alive: true,
  });
  const values = readings(round());
  assert.equal(values.humidity, null);
  assert.equal(values.outdoorTemperature, null);
  assert.equal(readings({ ...t6(), isAlive: false }).alive, false);
});

test('rooms: both priority schemas give the same rooms, the thermostat room is left out', () => {
  const current = parseRooms(t9(), fixture('priority'));
  assert.deepEqual(current, [
    { id: 1, name: 'Office', temperature: 76, humidity: 52, motion: 1 },
    { id: 2, name: 'Master Bedroom', temperature: 76, humidity: 52, motion: 0 },
  ]);
  const classic = parseRooms(t9(), fixture('priority-classic'));
  assert.deepEqual(classic, [current[0]]);
  assert.deepEqual(parseRooms(t9(), fixture('priority-whole-house')), []);
  assert.deepEqual(parseRooms(t9(), {}), []);
});

test('a room temperature in Fahrenheit under a Celsius thermostat is converted', () => {
  assert.equal(roomTemperature(t6(), 76), 24.4);
  assert.equal(roomTemperature(t6(), 21.25), 21.3);
  assert.equal(roomTemperature(t9(), 76), 76);
  assert.equal(roomTemperature(t9(), null), null);
});

test('a priority 400 GetPriorityFailed means "no room data"', () => {
  assert.equal(isPriorityUnsupported(400, fixture('priority-unsupported')), true);
  assert.equal(isPriorityUnsupported(400, { code: 'SomeOtherError' }), false);
  assert.equal(isPriorityUnsupported(500, fixture('priority-unsupported')), false);
});

test('a write sends every changeable value; following the schedule becomes a temporary hold', () => {
  assert.deepEqual(buildUpdate(t6(), { heatSetpoint: 19 }), {
    mode: 'Heat',
    heatSetpoint: 19,
    coolSetpoint: 28,
    autoChangeoverActive: false,
    thermostatSetpointStatus: HOLD.TEMPORARY,
  });
  assert.deepEqual(buildUpdate(t6(), { hold: HOLD.NONE }).thermostatSetpointStatus, HOLD.NONE);
  // A TCC thermostat gets no setpoint status.
  assert.deepEqual(buildUpdate(round(), { coolSetpoint: 75 }), {
    mode: 'Off',
    heatSetpoint: 68,
    coolSetpoint: 75,
    autoChangeoverActive: false,
  });
  // A "hold until" keeps its end time.
  const until = t6();
  until.changeableValues.thermostatSetpointStatus = HOLD.UNTIL;
  assert.equal(buildUpdate(until, { heatSetpoint: 18 }).nextPeriodTime, '19:00:00');
});

test('mode writes: LCC in one step, a TCC from off to auto through heat', () => {
  const lcc = modeWrites(t6(), THERMOSTAT_MODE.OFF);
  assert.equal(lcc.steps.length, 1);
  assert.equal(lcc.steps[0].mode, 'Off');

  const t9Heat = t9();
  t9Heat.changeableValues = {
    ...t9Heat.changeableValues,
    mode: 'Heat',
    autoChangeoverActive: false,
  };
  const toAuto = modeWrites(t9Heat, THERMOSTAT_MODE.AUTO);
  assert.equal(toAuto.steps[0].mode, 'Auto');
  assert.equal(toAuto.steps[0].autoChangeoverActive, true);

  const fromOff = modeWrites(round(), THERMOSTAT_MODE.AUTO);
  assert.deepEqual(
    fromOff.steps.map((step) => [step.mode, step.autoChangeoverActive]),
    [
      ['Heat', false],
      ['Heat', true],
    ],
  );
  assert.equal(fromOff.pauseMs, 3000);

  const roundHeat = round();
  roundHeat.changeableValues.mode = 'Heat';
  const fromHeat = modeWrites(roundHeat, THERMOSTAT_MODE.AUTO);
  assert.deepEqual(
    fromHeat.steps.map((step) => [step.mode, step.autoChangeoverActive]),
    [['Heat', true]],
  );
  assert.equal(modeWrites(round(), THERMOSTAT_MODE.COOLING).steps[0].autoChangeoverActive, false);
  // A mode the thermostat does not offer writes nothing.
  assert.deepEqual(modeWrites(t6(), THERMOSTAT_MODE.COOLING).steps, []);
});

test('an accepted write updates the stored payload, not the original', () => {
  const raw = t6();
  const next = applyUpdate(raw, { heatSetpoint: 21, thermostatSetpointStatus: HOLD.PERMANENT });
  assert.equal(next.changeableValues.heatSetpoint, 21);
  assert.equal(holdOption(next), 'permanent');
  assert.equal(raw.changeableValues.heatSetpoint, 15);
});
