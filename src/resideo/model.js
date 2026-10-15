// -----------------------------------------------------------------------------
// What a Resideo thermostat payload means, and what to send back to change it.
// Pure functions, no network: the JSON of GET /v2/locations (one device) and
// of GET /v2/devices/thermostats/{id}/priority (its rooms) in, a snapshot out.
//
// Two families share the API (the split of aiolyric and Home Assistant):
//   - LCC (T5, T6, T9, T10...): `changeableValues.thermostatSetpointStatus`
//     exists; schedule holds, "Auto" is a mode of its own;
//   - TCC (Lyric Round...): no setpoint status, "auto" is the flag
//     `autoChangeoverActive` on top of the Heat or Cool mode.
// Field names and quirks follow aiolyric (Apache-2.0) and the Home Assistant
// `lyric` integration (Apache-2.0); see the README credits.
// -----------------------------------------------------------------------------

// Gladys values (server/utils/constants.js of the core).
export const THERMOSTAT_MODE = Object.freeze({ OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 });
export const OPERATING_STATE = Object.freeze({ IDLE: 0, HEATING: 1, COOLING: 2 });

// Resideo values.
export const LYRIC_MODE = Object.freeze({ OFF: 'Off', HEAT: 'Heat', COOL: 'Cool', AUTO: 'Auto' });
export const HOLD = Object.freeze({
  NONE: 'NoHold',
  TEMPORARY: 'TemporaryHold',
  PERMANENT: 'PermanentHold',
  UNTIL: 'HoldUntil',
  VACATION: 'VacationHold',
});

// Values of the "Schedule" select of a device (text/select: string values).
// Keys are stored by Gladys with the states: never rename one.
export const HOLD_OPTIONS = Object.freeze({
  schedule: HOLD.NONE,
  temporary: HOLD.TEMPORARY,
  permanent: HOLD.PERMANENT,
  hold_until: HOLD.UNTIL,
  vacation: HOLD.VACATION,
});
// What a user may choose from Gladys: a "hold until" needs a time and a
// vacation needs dates, both set in the Resideo app.
export const SETTABLE_HOLDS = Object.freeze(['schedule', 'temporary', 'permanent']);

const MODE_TO_GLADYS = {
  [LYRIC_MODE.OFF]: THERMOSTAT_MODE.OFF,
  [LYRIC_MODE.HEAT]: THERMOSTAT_MODE.HEATING,
  [LYRIC_MODE.COOL]: THERMOSTAT_MODE.COOLING,
  [LYRIC_MODE.AUTO]: THERMOSTAT_MODE.AUTO,
};
export const MODE_FROM_GLADYS = Object.freeze(
  Object.fromEntries(Object.entries(MODE_TO_GLADYS).map(([lyric, gladys]) => [gladys, lyric])),
);

// Display bounds of the temperature sensors (not enforced by Gladys).
const SENSOR_BOUNDS = { celsius: [-20, 50], fahrenheit: [-4, 122] };
// Setpoint bounds used when the API gives none, or an unusable pair.
const SETPOINT_FALLBACK = { celsius: [5, 35], fahrenheit: [40, 95] };
// Above this, a room temperature of a Celsius thermostat is in Fahrenheit (see roomTemperature).
const CELSIUS_ROOM_MAX = 45;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const toNumber = (value) => {
  if (isNumber(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

/** 'celsius' or 'fahrenheit', the unit every temperature of the device is in. */
export const unitOf = (raw) => (raw?.units === 'Fahrenheit' ? 'fahrenheit' : 'celsius');

/** LCC thermostats carry a setpoint status (schedule holds); TCC ones do not. */
export const isLcc = (raw) => typeof raw?.changeableValues?.thermostatSetpointStatus === 'string';

/** The identity of a thermostat: its MAC address, the device id as a fallback. */
export function platformIdOf(raw) {
  const id = raw?.macID || raw?.deviceID;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/** A thermostat of the account (the API also lists water leak detectors, cameras...). */
export const isThermostat = (raw) =>
  raw?.deviceClass === 'Thermostat' && platformIdOf(raw) !== null && Boolean(raw.deviceID);

/** The name shown in Gladys: the one given in the Resideo app. */
export function displayName(raw) {
  for (const candidate of [raw?.userDefinedDeviceName, raw?.name]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim().slice(0, 60);
    }
  }
  return platformIdOf(raw) ?? 'Thermostat';
}

/** The Gladys modes this thermostat accepts (Off is always one). */
export function supportedModes(raw) {
  const allowed = Array.isArray(raw?.allowedModes) ? raw.allowedModes : [];
  const modes = [THERMOSTAT_MODE.OFF];
  if (allowed.includes(LYRIC_MODE.HEAT)) {
    modes.push(THERMOSTAT_MODE.HEATING);
  }
  if (allowed.includes(LYRIC_MODE.COOL)) {
    modes.push(THERMOSTAT_MODE.COOLING);
  }
  // A TCC thermostat does not list Auto, yet switches heat/cool on its own
  // when it can do both (Home Assistant climate.py).
  if (
    allowed.includes(LYRIC_MODE.AUTO) ||
    (!isLcc(raw) && allowed.includes(LYRIC_MODE.HEAT) && allowed.includes(LYRIC_MODE.COOL))
  ) {
    modes.push(THERMOSTAT_MODE.AUTO);
  }
  return modes;
}

/** The current Gladys mode, null when the API says something unknown. */
export function currentMode(raw) {
  const values = raw?.changeableValues ?? {};
  const mode = values.mode;
  if (
    !isLcc(raw) &&
    values.autoChangeoverActive === true &&
    (mode === LYRIC_MODE.HEAT || mode === LYRIC_MODE.COOL)
  ) {
    return THERMOSTAT_MODE.AUTO;
  }
  return MODE_TO_GLADYS[mode] ?? null;
}

/** What the equipment does now: idle, heating or cooling. */
export function operatingState(raw) {
  const mode = raw?.operationStatus?.mode;
  if (mode === 'Heat') {
    return OPERATING_STATE.HEATING;
  }
  if (mode === 'Cool') {
    return OPERATING_STATE.COOLING;
  }
  if (typeof mode === 'string') {
    return OPERATING_STATE.IDLE; // EquipmentOff, Fan...
  }
  return null;
}

/** The key of HOLD_OPTIONS matching the setpoint status, null on a TCC thermostat. */
export function holdOption(raw) {
  if (!isLcc(raw)) {
    return null;
  }
  const status = raw.changeableValues.thermostatSetpointStatus;
  const entry = Object.entries(HOLD_OPTIONS).find(([, value]) => value === status);
  return entry ? entry[0] : null;
}

/** [min, max] of a setpoint, from the API when it makes sense. */
function setpointBounds(raw, kind) {
  const min = toNumber(raw?.[`min${kind}Setpoint`]);
  const max = toNumber(raw?.[`max${kind}Setpoint`]);
  if (min !== null && max !== null && min < max) {
    return [min, max];
  }
  return SETPOINT_FALLBACK[unitOf(raw)];
}

export const heatBounds = (raw) => setpointBounds(raw, 'Heat');
export const coolBounds = (raw) => setpointBounds(raw, 'Cool');
export const sensorBounds = (raw) => SENSOR_BOUNDS[unitOf(raw)];
/** Smallest setpoint change: half a degree Celsius, one degree Fahrenheit. */
export const setpointStep = (raw) => (unitOf(raw) === 'fahrenheit' ? 1 : 0.5);

export const canHeat = (raw) =>
  Array.isArray(raw?.allowedModes) && raw.allowedModes.includes(LYRIC_MODE.HEAT);
export const canCool = (raw) =>
  Array.isArray(raw?.allowedModes) && raw.allowedModes.includes(LYRIC_MODE.COOL);

const fahrenheitToCelsius = (value) => Math.round((((value - 32) * 5) / 9) * 10) / 10;

/**
 * A room temperature, in the unit of the thermostat. The priority endpoint
 * is only documented by its Fahrenheit examples: a value no room reaches in
 * Celsius is taken for Fahrenheit and converted (hypothesis, see CLAUDE.md).
 */
export function roomTemperature(raw, value) {
  const number = toNumber(value);
  if (number === null) {
    return null;
  }
  if (unitOf(raw) === 'celsius' && number > CELSIUS_ROOM_MAX) {
    return fahrenheitToCelsius(number);
  }
  return Math.round(number * 10) / 10;
}

const first = (object, ...keys) => {
  for (const key of keys) {
    if (object && key in object) {
      return object[key];
    }
  }
  return undefined;
};

/**
 * The rooms with a remote sensor (T9/T10 "smart room sensors"), from the
 * priority payload. Resideo serves two schemas (aiolyric#165): both are read.
 * The room of the thermostat alone is left out: the thermostat already
 * publishes its own readings.
 * @returns {Array<{ id: number, name: string, temperature: number|null, humidity: number|null, motion: number|null }>}
 */
export function parseRooms(raw, priority) {
  const current = first(priority, 'priority', 'currentPriority') ?? {};
  const rooms = Array.isArray(current.rooms) ? current.rooms : [];
  const parsed = [];
  for (const room of rooms) {
    const id = toNumber(room?.id);
    if (id === null || !Number.isInteger(id) || id < 0) {
      continue;
    }
    const accessories = Array.isArray(room.accessories) ? room.accessories : [];
    const hasSensor = accessories.some(
      (accessory) => first(accessory, 'sensorType', 'type') === 'IndoorAirSensor',
    );
    if (!hasSensor) {
      continue;
    }
    const name = first(room, 'name', 'roomName');
    const humidity = toNumber(first(room, 'avgHumidity', 'roomAvgHumidity'));
    const motion = room.overallMotion;
    parsed.push({
      id,
      name: typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 30) : `#${id}`,
      temperature: roomTemperature(raw, first(room, 'avgTemperature', 'roomAvgTemp')),
      humidity: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
      motion: typeof motion === 'boolean' ? (motion ? 1 : 0) : null,
    });
  }
  return parsed.sort((a, b) => a.id - b.id);
}

/** Whether a priority answer says "this thermostat has no room data" (HA coordinator.py). */
export const isPriorityUnsupported = (status, body) =>
  status === 400 && body && typeof body === 'object' && body.code === 'GetPriorityFailed';

/** Readings of the thermostat itself, null where the API gives none. */
export function readings(raw) {
  const values = raw?.changeableValues ?? {};
  const humidity = toNumber(raw?.indoorHumidity);
  return {
    temperature: toNumber(raw?.indoorTemperature),
    humidity: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
    outdoorTemperature: toNumber(raw?.outdoorTemperature),
    heatSetpoint: toNumber(values.heatSetpoint),
    coolSetpoint: toNumber(values.coolSetpoint),
    mode: currentMode(raw),
    operatingState: operatingState(raw),
    hold: holdOption(raw),
    alive: raw?.isAlive !== false,
  };
}

// --- Writing -------------------------------------------------------------------

/** Round a setpoint to the thermostat's step, inside its bounds. */
export function fitSetpoint(raw, value, [min, max]) {
  const step = setpointStep(raw);
  const rounded = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, rounded));
}

/**
 * The body of POST /v2/devices/thermostats/{deviceId}: every changeable value
 * is sent, the ones not changed copied from the last reading (aiolyric
 * update_thermostat). A setpoint sent while following the schedule becomes a
 * temporary hold, like on the thermostat itself.
 * @param {object} raw the last device payload
 * @param {object} change
 * @param {string} [change.mode] Resideo mode
 * @param {number} [change.heatSetpoint]
 * @param {number} [change.coolSetpoint]
 * @param {boolean} [change.autoChangeoverActive]
 * @param {string} [change.hold] Resideo setpoint status
 */
export function buildUpdate(raw, change = {}) {
  const values = raw?.changeableValues ?? {};
  const body = {
    mode: change.mode ?? values.mode,
    heatSetpoint: change.heatSetpoint ?? values.heatSetpoint,
    coolSetpoint: change.coolSetpoint ?? values.coolSetpoint,
  };
  // TCC only.
  if (change.autoChangeoverActive !== undefined) {
    body.autoChangeoverActive = change.autoChangeoverActive;
  } else if (typeof values.autoChangeoverActive === 'boolean') {
    body.autoChangeoverActive = values.autoChangeoverActive;
  }
  // LCC only.
  if (change.hold !== undefined) {
    body.thermostatSetpointStatus = change.hold;
  } else if (typeof values.thermostatSetpointStatus === 'string') {
    body.thermostatSetpointStatus =
      values.thermostatSetpointStatus === HOLD.NONE
        ? HOLD.TEMPORARY
        : values.thermostatSetpointStatus;
  }
  if (body.thermostatSetpointStatus === HOLD.UNTIL && values.nextPeriodTime) {
    body.nextPeriodTime = values.nextPeriodTime;
  }
  return body;
}

/**
 * The writes that switch a thermostat to a Gladys mode, in order. A TCC
 * thermostat turned from Off to auto must go through Heat first, or it falls
 * back to Off (Home Assistant climate.py, same behaviour in the Resideo app).
 * @returns {{ steps: object[], pauseMs: number }}
 */
export function modeWrites(raw, gladysMode) {
  const target = MODE_FROM_GLADYS[gladysMode];
  if (!target || !supportedModes(raw).includes(gladysMode)) {
    return { steps: [], pauseMs: 0 };
  }
  const values = raw?.changeableValues ?? {};
  if (isLcc(raw)) {
    const change = { mode: target };
    if (target === LYRIC_MODE.AUTO && values.autoChangeoverActive === false) {
      change.autoChangeoverActive = true;
    }
    return { steps: [buildUpdate(raw, change)], pauseMs: 0 };
  }
  if (target !== LYRIC_MODE.AUTO) {
    return {
      steps: [buildUpdate(raw, { mode: target, autoChangeoverActive: false })],
      pauseMs: 0,
    };
  }
  if (values.mode === LYRIC_MODE.OFF || !values.mode) {
    return {
      steps: [
        buildUpdate(raw, { mode: LYRIC_MODE.HEAT, autoChangeoverActive: false }),
        buildUpdate(raw, { mode: LYRIC_MODE.HEAT, autoChangeoverActive: true }),
      ],
      pauseMs: 3000,
    };
  }
  return { steps: [buildUpdate(raw, { autoChangeoverActive: true })], pauseMs: 0 };
}

/**
 * Apply an accepted write to the stored payload, so the states follow the
 * command at once instead of five minutes later.
 */
export function applyUpdate(raw, body) {
  const next = structuredClone(raw);
  next.changeableValues = { ...(next.changeableValues ?? {}), ...body };
  return next;
}
