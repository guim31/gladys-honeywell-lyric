// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the payloads of aiolyric and Home Assistant): a T6 in Celsius, a
// T9 in Fahrenheit with room sensors, a Lyric Round, the classic priority
// schema, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled and guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, FakeResideo, createClock, createWorld } from './helpers/world.js';
import { fixture } from './helpers/fakeResideo.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** A second account: the T9 in Celsius with the classic room schema, a Round in auto. */
function otherAccount(clock) {
  const t9 = fixture('device-t9-fahrenheit');
  Object.assign(t9, {
    units: 'Celsius',
    indoorTemperature: 21.5,
    outdoorTemperature: -3,
    minHeatSetpoint: 4.5,
    maxHeatSetpoint: 32,
    minCoolSetpoint: 10,
    maxCoolSetpoint: 37,
    deadband: 1.5,
  });
  t9.changeableValues = { ...t9.changeableValues, heatSetpoint: 19.5, coolSetpoint: 24 };
  const round = fixture('device-round-tcc');
  round.changeableValues = { ...round.changeableValues, mode: 'Heat', autoChangeoverActive: true };
  return new FakeResideo({
    now: clock.now,
    locations: [{ locationID: 345678, devices: [t9, round] }],
    priorities: { [t9.deviceID]: fixture('priority-classic') },
  });
}

const scenarios = [
  { label: 'default account, English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
  { label: 'Celsius T9, classic rooms, Round in auto', language: 'fr', account: otherAccount },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const clock = createClock();
    const { gladys, app } = await createWorld({
      clock,
      resideo: scenario.account?.(clock),
      config: { ...CONFIG, language: scenario.language },
    });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.ok(devices.length >= 2, 'no device discovered');
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} not for ${feature.category}`,
              );
            }
          }
          if (feature.step !== undefined) {
            assert.ok(feature.step > 0, `${at}: step must be positive`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds.
          const value = gladys.fake.lastState(feature.external_id);
          if (feature.category === 'text') {
            assert.equal(typeof value, 'string', `${at}: no text state published`);
            const options = feature.supported_options.map((option) => option.value);
            assert.ok(options.includes(value), `${at}: "${value}" is not an option`);
          } else {
            assert.equal(typeof value, 'number', `${at}: no state published`);
            assert.ok(
              value >= feature.min && value <= feature.max,
              `${at}: ${value} out of bounds`,
            );
            if (['integer', 'binary', 'mode', 'operating-state'].includes(feature.type)) {
              assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
            }
          }

          // Options: unique values, a label each, inside the bounds for numbers.
          if (feature.supported_options) {
            const values = feature.supported_options.map((option) => String(option.value));
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option`);
            for (const option of feature.supported_options) {
              assert.ok(
                typeof option.label === 'string' && option.label.trim(),
                `${at}: option without label`,
              );
              if (feature.category !== 'text') {
                assert.ok(
                  Number.isInteger(option.value),
                  `${at}: option ${option.value} not an integer`,
                );
                assert.ok(
                  option.value >= feature.min && option.value <= feature.max,
                  `${at}: option out of bounds`,
                );
              }
            }
          }
        }
      }
    } finally {
      await app.stop();
    }
  });
}
