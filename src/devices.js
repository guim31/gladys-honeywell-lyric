// -----------------------------------------------------------------------------
// The Gladys device of one Resideo thermostat, and the value of each of its
// features. One device per thermostat, identified by its MAC address (the id
// Home Assistant uses too): never a name, never the location.
//
// Feature keys are stored by Gladys with the history: never rename one.
// The room sensors of a T9/T10 are features of their thermostat, keyed by
// the room id Resideo gives (stable per thermostat).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  HOLD_OPTIONS,
  canCool,
  canHeat,
  coolBounds,
  heatBounds,
  isLcc,
  platformIdOf,
  readings,
  sensorBounds,
  setpointStep,
  supportedModes,
  unitOf,
  displayName,
} from './resideo/model.js';
import { HOLD_LABELS, MODE_LABELS, NAMES, format, pick } from './texts.js';

export const DEVICE_TYPE = 'thermostat';

export const FEATURES = Object.freeze({
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  OUTDOOR_TEMPERATURE: 'outdoor_temperature',
  HEAT_SETPOINT: 'heat_setpoint',
  COOL_SETPOINT: 'cool_setpoint',
  MODE: 'mode',
  OPERATING_STATE: 'operating_state',
  HOLD: 'hold',
});

export const roomKey = (roomId, what) => `room_${roomId}_${what}`;
const ROOM_KEY = /^room_(\d+)_(temperature|humidity|presence)$/;

/** The external ids of the thermostat with this platform id (MAC address). */
export const deviceIds = (gladys, platformId) => gladys.externalIds(DEVICE_TYPE, platformId);

/**
 * The platform id and the feature key behind external ids of this integration.
 * @returns {{ platformId: string, key: string|null }|null}
 */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const rest = externalId.slice(prefix.length);
  const at = rest.indexOf(':');
  return at === -1
    ? { platformId: rest, key: null }
    : { platformId: rest.slice(0, at), key: rest.slice(at + 1) };
}

const unitConstant = (raw) => (unitOf(raw) === 'fahrenheit' ? UNITS.FAHRENHEIT : UNITS.CELSIUS);

const sensor = (key, name, category, type, [min, max], unit) => ({
  key,
  name,
  category,
  type,
  min,
  max,
  ...(unit ? { unit } : {}),
  read_only: true,
  has_feedback: false,
});

/**
 * The features of a thermostat, from its last payload and its rooms.
 * @param {object} raw device payload of GET /v2/locations
 * @param {Array} rooms parsed rooms (model.parseRooms)
 * @param {string} language
 */
export function featureSpecs(raw, rooms, language) {
  const names = NAMES[language] ?? NAMES.en;
  const unit = unitConstant(raw);
  const values = readings(raw);
  const specs = [];

  if (values.temperature !== null) {
    specs.push(
      sensor(
        FEATURES.TEMPERATURE,
        names.temperature,
        CATEGORIES.TEMPERATURE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        sensorBounds(raw),
        unit,
      ),
    );
  }
  if (values.humidity !== null) {
    specs.push(
      sensor(
        FEATURES.HUMIDITY,
        names.humidity,
        CATEGORIES.HUMIDITY_SENSOR,
        TYPES.SENSOR.DECIMAL,
        [0, 100],
        UNITS.PERCENT,
      ),
    );
  }
  if (values.outdoorTemperature !== null) {
    specs.push(
      sensor(
        FEATURES.OUTDOOR_TEMPERATURE,
        names.outdoor_temperature,
        CATEGORIES.TEMPERATURE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        sensorBounds(raw),
        unit,
      ),
    );
  }
  for (const [key, can, bounds] of [
    [FEATURES.HEAT_SETPOINT, canHeat, heatBounds],
    [FEATURES.COOL_SETPOINT, canCool, coolBounds],
  ]) {
    if (!can(raw)) {
      continue;
    }
    const [min, max] = bounds(raw);
    specs.push({
      key,
      name: names[key],
      category: CATEGORIES.THERMOSTAT,
      type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
      min,
      max,
      step: setpointStep(raw),
      unit,
      read_only: false,
      has_feedback: true,
    });
  }
  const modes = supportedModes(raw);
  const modeLabels = MODE_LABELS[language] ?? MODE_LABELS.en;
  specs.push({
    key: FEATURES.MODE,
    name: names.mode,
    category: CATEGORIES.THERMOSTAT,
    type: TYPES.THERMOSTAT.MODE,
    min: 0,
    max: Math.max(...modes),
    read_only: false,
    has_feedback: true,
    supported_options: modes.map((value, index) => ({
      value,
      label: modeLabels[value],
      sort_order: index,
    })),
  });
  if (values.operatingState !== null) {
    specs.push(
      sensor(
        FEATURES.OPERATING_STATE,
        names.operating_state,
        CATEGORIES.THERMOSTAT,
        TYPES.THERMOSTAT.OPERATING_STATE,
        [0, 2],
      ),
    );
  }
  if (isLcc(raw)) {
    const holdLabels = HOLD_LABELS[language] ?? HOLD_LABELS.en;
    specs.push({
      key: FEATURES.HOLD,
      name: names.hold,
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      supported_options: Object.keys(HOLD_OPTIONS).map((value, index) => ({
        value,
        label: holdLabels[value],
        sort_order: index,
      })),
    });
  }
  for (const room of rooms ?? []) {
    const named = (template) => format(template, { room: room.name }).slice(0, 60);
    if (room.temperature !== null) {
      specs.push(
        sensor(
          roomKey(room.id, 'temperature'),
          named(names.room_temperature),
          CATEGORIES.TEMPERATURE_SENSOR,
          TYPES.SENSOR.DECIMAL,
          sensorBounds(raw),
          unit,
        ),
      );
    }
    if (room.humidity !== null) {
      specs.push(
        sensor(
          roomKey(room.id, 'humidity'),
          named(names.room_humidity),
          CATEGORIES.HUMIDITY_SENSOR,
          TYPES.SENSOR.DECIMAL,
          [0, 100],
          UNITS.PERCENT,
        ),
      );
    }
    if (room.motion !== null) {
      specs.push(
        sensor(
          roomKey(room.id, 'presence'),
          named(names.room_presence),
          CATEGORIES.PRESENCE_SENSOR,
          TYPES.SENSOR.BINARY,
          [0, 1],
        ),
      );
    }
  }
  return specs;
}

/**
 * The device published in the Discovery tab.
 * @param {object} gladys
 * @param {{ raw: object, rooms: Array }} thermostat
 * @param {string} language
 */
export function buildDevice(gladys, { raw, rooms }, language) {
  const platformId = platformIdOf(raw);
  const ids = deviceIds(gladys, platformId);
  const model = typeof raw.deviceModel === 'string' ? raw.deviceModel : null;
  return {
    name: displayName(raw),
    external_id: ids.device,
    ...(model ? { model: `Honeywell Home ${model}`.slice(0, 60) } : {}),
    // The container reads the cloud on its own timer (Gladys#3198): Gladys
    // is never asked to poll.
    should_poll: false,
    features: featureSpecs(raw, rooms, language).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature of a thermostat: a number, `{ text }` for the
 * schedule select, null when unknown.
 * @returns {Array<{ externalId: string, value: number|{ text: string }|null }>}
 */
export function featureValues(gladys, { raw, rooms }) {
  const ids = deviceIds(gladys, platformIdOf(raw));
  const values = readings(raw);
  const known = {
    [FEATURES.TEMPERATURE]: values.temperature,
    [FEATURES.HUMIDITY]: values.humidity,
    [FEATURES.OUTDOOR_TEMPERATURE]: values.outdoorTemperature,
    [FEATURES.HEAT_SETPOINT]: values.heatSetpoint,
    [FEATURES.COOL_SETPOINT]: values.coolSetpoint,
    [FEATURES.MODE]: values.mode,
    [FEATURES.OPERATING_STATE]: values.operatingState,
    [FEATURES.HOLD]: values.hold === null ? null : { text: values.hold },
  };
  for (const room of rooms ?? []) {
    known[roomKey(room.id, 'temperature')] = room.temperature;
    known[roomKey(room.id, 'humidity')] = room.humidity;
    known[roomKey(room.id, 'presence')] = room.motion;
  }
  return featureSpecs(raw, rooms, 'en').map(({ key }) => ({
    externalId: ids.feature(key),
    value: known[key] ?? null,
  }));
}

/** Whether a feature key is a room sensor (read only). */
export const isRoomKey = (key) => ROOM_KEY.test(key);

/** The localized label of a hold option. */
export const holdLabel = (option, language) => pick(HOLD_LABELS, language)[option] ?? option;
