// -----------------------------------------------------------------------------
// The Honeywell Home hub: signs in to Resideo (OAuth2), reads every thermostat
// of the account on a timer of the container, publishes the devices and their
// states to Gladys, fires the scene events, and carries out the commands of
// the devices, the configuration actions and the scene actions.
//
// Gladys never polls these devices (should_poll: false): the core does not
// poll external devices reliably (Gladys#3198) and its scheduler has no
// 5-minute pace. onPoll is kept as a fallback and respects the same pace.
//
// API budget: one GET /v2/locations per reading (it carries every device of
// every location), plus one GET .../priority per thermostat that has room
// sensors, every 5 minutes; a command adds its write and one reading 15 s
// later. A 429 doubles the interval, up to 30 minutes.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { OAUTH_FIELD, hasCredentials } from './config.js';
import {
  FEATURES,
  buildDevice,
  deviceIds,
  featureValues,
  holdLabel,
  parseExternalId,
} from './devices.js';
import { ERROR_KINDS, ResideoClient, ResideoError } from './resideo/client.js';
import {
  HOLD_OPTIONS,
  SETTABLE_HOLDS,
  THERMOSTAT_MODE,
  buildUpdate,
  applyUpdate,
  canCool,
  canHeat,
  coolBounds,
  currentMode,
  displayName,
  fitSetpoint,
  heatBounds,
  isLcc,
  isThermostat,
  modeWrites,
  parseRooms,
  platformIdOf,
  readings,
  supportedModes,
  unitOf,
} from './resideo/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  LANGS,
  MODE_LABELS,
  REPORT_TEXT,
  STATUS_TEXT,
  format,
  localized,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'lyric-hub' });

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  OFFLINE: 'thermostat_offline',
  ONLINE: 'thermostat_online',
  AUTH_LOST: 'authorization_lost',
});

export const HUB_TIMINGS = {
  // The pace Resideo sizes its free quota for (and Home Assistant uses).
  pollMs: 5 * 60_000,
  // Slowest pace after repeated 429 answers.
  maxPollMs: 30 * 60_000,
  // A reading this soon after a command confirms what the thermostat applied.
  confirmMs: 15_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 h, and a heartbeat within 12 h is the rule.
  heartbeatMs: 6 * 60 * 60_000,
  // Sign-in started with "Connect" stays valid this long.
  oauthMs: 30 * 60_000,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A temperature typed in a scene: a number, or a string ("19.5", "19,5"). */
export function parseTemperature(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const number = Number(raw.trim().replace(',', '.'));
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/** The authorization code in what the user pasted: the code, or the whole address. */
export function parsePastedCode(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  const trimmed = text.trim();
  if (/[?&]code=/.test(trimmed)) {
    try {
      const url = new URL(
        trimmed.includes('://') ? trimmed : `https://x/${trimmed.replace(/^\/?/, '')}`,
      );
      const code = url.searchParams.get('code');
      return code ? { code, state: url.searchParams.get('state') } : null;
    } catch {
      return null;
    }
  }
  return /^[\w.~-]+$/.test(trimmed) ? { code: trimmed, state: null } : null;
}

/**
 * The state of the integration inside the one the provider gives back. The
 * Gladys front wraps it with the address of the instance when the flow goes
 * through its HTTPS redirect page (front/src/utils/oauth.js, Gladys 4.85+):
 * base64url of { v, origin, path, state }. A state that is not wrapped is
 * returned as is.
 */
export function unwrapState(state) {
  if (typeof state !== 'string' || state === '') {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    if (decoded && typeof decoded === 'object' && typeof decoded.state === 'string') {
      return decoded.state;
    }
  } catch {
    // not a wrapped state
  }
  return state;
}

export class LyricHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.tokens TokenStore (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/resideo/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({ gladys, tokens, request, timers = true, timings, now, sleep: wait }) {
    this.gladys = gladys;
    this.tokens = tokens;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.sleep = wait ?? sleep;
    this.config = null;
    this.client = null;
    this.clientKey = null;
    /** @type {Map<string, { raw: object, locationId: unknown, rooms: Array, priority: 'unknown'|'yes'|'no' }>} */
    this.thermostats = new Map();
    this.error = null; // { kind } of the last failed reading
    this.readOnce = false;
    this.lastReadAt = 0;
    this.backoff = 1;
    this.reading = null;
    this.oauth = null; // { state, redirectUri, at }
    this.devicesKey = null;
    this.transports = new Map();
    this.connection = null;
    this.authLostFired = false;
    this.pollTimer = null;
    this.confirmTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (sign-in, connected, lost, back, thermostat
  // offline / online, user commands). A problem that repeats every cycle is
  // logged once at its level, then at debug until it clears.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  /** An Error whose message is the text of `table` in the configured language. */
  fail(table, values) {
    return new Error(format(pick(table, this.language), values));
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.devicesKey = null;
    this.transports.clear();
    this.connection = null;
    this.gladys.forgetPublishedStates?.();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config && this.config.language !== config.language;
    this.config = config;
    const key = JSON.stringify([config.consumerKey, config.consumerSecret]);
    if (key !== this.clientKey) {
      this.clientKey = key;
      this.client = hasCredentials(config)
        ? new ResideoClient({
            consumerKey: config.consumerKey,
            consumerSecret: config.consumerSecret,
            tokens: this.tokens,
            request: this.request,
            now: this.now,
          })
        : null;
      this.thermostats.clear();
      this.readOnce = false;
      this.lastReadAt = 0;
      this.authLostFired = false;
    }
    if (languageChanged) {
      this.devicesKey = null;
    }
    await this.refresh();
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.confirmTimer);
    await this.reading?.catch(() => {});
    await this.tokens.flush();
  }

  pollInterval() {
    return Math.min(this.timings.pollMs * this.backoff, this.timings.maxPollMs);
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    const interval = this.pollInterval();
    this.pollTimer = setTimeout(async () => {
      try {
        // A reading made meanwhile (a command, a test) counts: never read
        // twice within half the interval.
        if (this.now() - this.lastReadAt >= interval / 2) {
          await this.refresh();
        }
        this.resolved('timer');
      } catch (err) {
        this.problem('timer', `Reading failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, interval);
    this.pollTimer.unref?.();
  }

  /** Read the cloud again shortly after a command, once per burst. */
  scheduleConfirm() {
    clearTimeout(this.confirmTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.confirmTimer = setTimeout(() => {
      this.refresh().catch((err) =>
        this.problem('confirm', `Reading after a command failed: ${err.message}`, 'error'),
      );
    }, this.timings.confirmMs);
    this.confirmTimer.unref?.();
  }

  // --- Reading the cloud -----------------------------------------------------------

  /** Read every thermostat now. Concurrent calls share the reading. */
  refresh() {
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async read() {
    if (!this.client) {
      await this.applyFailure(new ResideoError(ERROR_KINDS.NOT_CONFIGURED, 'Not configured'));
      return;
    }
    try {
      if (!(await this.client.isConnected())) {
        throw new ResideoError(ERROR_KINDS.NOT_CONNECTED, 'Not connected');
      }
      const locations = await this.client.getLocations();
      const next = new Map();
      for (const location of locations) {
        for (const raw of Array.isArray(location?.devices) ? location.devices : []) {
          if (!isThermostat(raw)) {
            continue;
          }
          const platformId = platformIdOf(raw);
          const previous = this.thermostats.get(platformId);
          next.set(platformId, {
            raw,
            locationId: location.locationID ?? raw.locationID,
            rooms: previous?.rooms ?? [],
            priority: previous?.priority ?? 'unknown',
          });
        }
      }
      for (const thermostat of next.values()) {
        await this.readRooms(thermostat);
      }
      await this.applySuccess(next);
    } catch (err) {
      if (!(err instanceof ResideoError)) {
        throw err;
      }
      await this.applyFailure(err);
    }
  }

  /** The room sensors of a T9/T10; a thermostat without any is not asked again. */
  async readRooms(thermostat) {
    if (thermostat.priority === 'no') {
      return;
    }
    const label = this.label(thermostat);
    try {
      const priority = await this.client.getPriority(
        thermostat.locationId,
        thermostat.raw.deviceID,
      );
      if (priority === null) {
        thermostat.priority = 'no';
        thermostat.rooms = [];
        logger.debug(`${label}: no room sensor data`);
        return;
      }
      thermostat.priority = 'yes';
      thermostat.rooms = parseRooms(thermostat.raw, priority);
      this.resolved(`rooms:${platformIdOf(thermostat.raw)}`);
    } catch (err) {
      // The quota and the sign-in concern every call: let the reading fail.
      if (
        !(err instanceof ResideoError) ||
        [ERROR_KINDS.AUTH, ERROR_KINDS.RATE_LIMIT].includes(err.kind)
      ) {
        throw err;
      }
      // Keep the last rooms; the thermostat itself is still published.
      this.problem(
        `rooms:${platformIdOf(thermostat.raw)}`,
        `${label}: room sensors not read: ${err.message}`,
      );
    }
  }

  label(thermostat) {
    return `Thermostat ${displayName(thermostat.raw)}`;
  }

  async applySuccess(next) {
    const previous = this.thermostats;
    this.thermostats = next;
    this.lastReadAt = this.now();
    this.backoff = 1;
    this.authLostFired = false;
    const wasSignedOut = [ERROR_KINDS.NOT_CONFIGURED, ERROR_KINDS.NOT_CONNECTED].includes(
      this.error?.kind,
    );
    if (this.error && !wasSignedOut) {
      logger.info(`Resideo cloud: connection restored (${next.size} thermostat(s))`);
    } else if (!this.readOnce || wasSignedOut) {
      logger.info(`Resideo cloud: connected (${next.size} thermostat(s))`);
    }
    this.error = null;
    this.readOnce = true;
    for (const key of [...this.warned].filter((k) => k.startsWith('read:'))) {
      this.warned.delete(key);
    }

    for (const [platformId, thermostat] of next) {
      const before = previous.get(platformId);
      const alive = readings(thermostat.raw).alive;
      if (before && readings(before.raw).alive !== alive) {
        if (alive) {
          logger.info(`${this.label(thermostat)} is online again`);
          await this.fire(TRIGGERS.ONLINE, thermostat);
        } else {
          logger.info(`${this.label(thermostat)} is offline`);
          await this.fire(TRIGGERS.OFFLINE, thermostat);
        }
      }
    }
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  async applyFailure(err) {
    const kind = err.kind;
    const before = this.error?.kind;
    this.error = { kind };
    switch (kind) {
      case ERROR_KINDS.NOT_CONFIGURED:
      case ERROR_KINDS.NOT_CONNECTED:
        logger.debug(err.message);
        break;
      case ERROR_KINDS.AUTH:
        this.problem('read:auth', `Resideo refused the sign-in: ${err.message}`);
        if (!this.authLostFired) {
          this.authLostFired = true;
          await this.fire(TRIGGERS.AUTH_LOST, null);
        }
        break;
      case ERROR_KINDS.RATE_LIMIT:
        this.backoff = Math.min(this.backoff * 2, 8);
        this.problem(
          'read:rate',
          `Resideo API quota reached, next reading in ${Math.round(this.pollInterval() / 60_000)} min`,
        );
        break;
      default:
        this.problem(`read:${kind}`, `Resideo cloud: ${err.message}`);
    }
    if (before !== kind) {
      logger.debug(`Reading failed (${kind})`);
    }
    // Without the cloud, the thermostats cannot be reached from Gladys.
    if ([ERROR_KINDS.AUTH, ERROR_KINDS.UNREACHABLE].includes(kind)) {
      await this.publishTransports({ reachable: false });
    }
    await this.publishConnectionStatus();
  }

  async fire(key, thermostat) {
    const data =
      thermostat === null
        ? {}
        : {
            device: deviceIds(this.gladys, platformIdOf(thermostat.raw)).device,
            name: displayName(thermostat.raw),
          };
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  async publishDevices() {
    const devices = [...this.thermostats.values()].map((thermostat) =>
      buildDevice(this.gladys, thermostat, this.language),
    );
    const key = JSON.stringify(devices);
    if (key === this.devicesKey) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesKey = key;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Devices refused by Gladys: ${err.message}`, 'error');
    }
  }

  /** "Search" in the Discovery tab: read now, publish again. */
  async rediscover() {
    this.devicesKey = null;
    await this.refresh();
    await this.publishDevices();
  }

  stateList(thermostats) {
    const states = [];
    for (const thermostat of thermostats) {
      for (const { externalId, value } of featureValues(this.gladys, thermostat)) {
        if (value === null || value === undefined) {
          continue;
        }
        states.push(
          typeof value === 'object'
            ? { device_feature_external_id: externalId, text: value.text }
            : { device_feature_external_id: externalId, state: value },
        );
      }
    }
    return states;
  }

  async publishStates(thermostats = [...this.thermostats.values()]) {
    const states = this.stateList(thermostats);
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused by Gladys: ${err.message}`);
    }
  }

  /** The user added a device: send its states again (Gladys dropped the earlier ones). */
  async onDeviceCreated(device) {
    const parsed = parseExternalId(this.gladys, device.external_id);
    const thermostat = parsed && this.thermostats.get(parsed.platformId);
    if (!thermostat) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates([thermostat]);
    await this.publishTransports();
  }

  async publishTransports({ reachable = true } = {}) {
    const entries = [];
    for (const thermostat of this.thermostats.values()) {
      const externalId = deviceIds(this.gladys, platformIdOf(thermostat.raw)).device;
      const transport =
        reachable && readings(thermostat.raw).alive
          ? DEVICE_TRANSPORTS.CLOUD
          : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused by Gladys: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.error) {
      return { connected: false, message: STATUS_TEXT[this.error.kind] };
    }
    if (!this.readOnce) {
      return { connected: false, message: STATUS_TEXT[ERROR_KINDS.NOT_CONNECTED] };
    }
    if (this.config.callbackUrlInvalid) {
      return { connected: true, message: CONNECTION_TEXT.invalidCallback };
    }
    if (this.thermostats.size === 0) {
      return { connected: true, message: CONNECTION_TEXT.noThermostat };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  /** Gladys asks for a refresh (onPoll): read only if the last reading is old enough. */
  async pollDevice() {
    if (this.now() - this.lastReadAt >= this.pollInterval()) {
      await this.refresh();
    }
  }

  // --- OAuth2 ----------------------------------------------------------------------------

  requireClient() {
    if (!this.client) {
      throw this.fail(STATUS_TEXT[ERROR_KINDS.NOT_CONFIGURED]);
    }
    return this.client;
  }

  /** "Connect" clicked: the Resideo sign-in page. */
  authorizeUrl(key, redirectUri) {
    if (key !== OAUTH_FIELD) {
      throw new Error(`Unknown OAuth2 field ${key}`);
    }
    const client = this.requireClient();
    // A callback URL typed in the configuration wins: the user then pastes the
    // code shown in the address bar (action "Paste the authorization code").
    const redirect = this.config.callbackUrl ?? redirectUri;
    if (!redirect) {
      throw this.fail(ACTION_TEXT.noCallback);
    }
    this.oauth = { state: randomUUID(), redirectUri: redirect, at: this.now() };
    logger.info(
      `Sign-in to Resideo started (${this.config.callbackUrl ? 'pasted code' : 'Gladys callback'})`,
    );
    return client.authorizeUrl(redirect, this.oauth.state);
  }

  /** Gladys relays the redirect of Resideo: exchange the code. */
  async oauthCallback(key, { code, state, redirectUri }) {
    if (key !== OAUTH_FIELD) {
      throw new Error(`Unknown OAuth2 field ${key}`);
    }
    if (
      !this.oauth ||
      unwrapState(state) !== this.oauth.state ||
      this.now() - this.oauth.at > this.timings.oauthMs
    ) {
      throw this.fail(ACTION_TEXT.stateMismatch);
    }
    await this.exchange(code, this.oauth.redirectUri ?? redirectUri);
  }

  /** Action "Paste the authorization code" (callback URL typed in the configuration). */
  async pasteCode(fields = {}) {
    if (!this.config.callbackUrl) {
      throw this.fail(ACTION_TEXT.noCallback);
    }
    const pasted = parsePastedCode(fields.code);
    if (!pasted) {
      throw this.fail(ACTION_TEXT.noCode);
    }
    if (pasted.state && unwrapState(pasted.state) !== this.oauth?.state) {
      throw this.fail(ACTION_TEXT.stateMismatch);
    }
    await this.exchange(pasted.code, this.config.callbackUrl);
    return localized(ACTION_TEXT.connected, { count: this.thermostats.size });
  }

  async exchange(code, redirectUri) {
    const client = this.requireClient();
    try {
      await client.exchangeCode(code, redirectUri);
    } catch (err) {
      if (err instanceof ResideoError) {
        logger.warn(`Sign-in to Resideo failed: ${err.message}`);
        throw this.fail(
          err.kind === ERROR_KINDS.AUTH ? ACTION_TEXT.codeRefused : STATUS_TEXT[err.kind],
        );
      }
      throw err;
    }
    this.oauth = null;
    this.authLostFired = false;
    logger.info('Signed in to Resideo');
    await this.refresh();
    if (this.error) {
      throw this.fail(STATUS_TEXT[this.error.kind]);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  thermostatOf(externalId) {
    const parsed = parseExternalId(this.gladys, externalId);
    const thermostat = parsed && this.thermostats.get(parsed.platformId);
    if (!thermostat) {
      throw this.fail(ACTION_TEXT.unknownThermostat);
    }
    return { thermostat, key: parsed.key };
  }

  /** A command of a device feature (dashboard, scene "control a device"). */
  async setValue(device, feature, value) {
    const { thermostat, key } = this.thermostatOf(feature.external_id ?? device.external_id);
    switch (key) {
      case FEATURES.HEAT_SETPOINT:
        return this.setSetpoint(thermostat, 'heat', value);
      case FEATURES.COOL_SETPOINT:
        return this.setSetpoint(thermostat, 'cool', value);
      case FEATURES.MODE:
        return this.setMode(thermostat, Number(value));
      case FEATURES.HOLD:
        return this.setHold(thermostat, String(value));
      default:
        throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
  }

  /**
   * Change a setpoint. `kind` 'heat' or 'cool'; `hold` a Resideo setpoint
   * status (scene action), else a temporary hold like on the thermostat.
   * @returns {Promise<number>} the setpoint sent, rounded and bounded
   */
  async setSetpoint(thermostat, kind, rawValue, hold) {
    const { raw } = thermostat;
    const value = parseTemperature(rawValue);
    if (value === null) {
      throw this.fail(ACTION_TEXT.invalidTemperature);
    }
    const mode = currentMode(raw);
    if (mode === THERMOSTAT_MODE.OFF) {
      throw this.fail(ACTION_TEXT.thermostatOff);
    }
    if (kind === 'heat' ? !canHeat(raw) : !canCool(raw)) {
      throw this.fail(ACTION_TEXT.modeUnsupported);
    }
    const setpoint = fitSetpoint(raw, value, kind === 'heat' ? heatBounds(raw) : coolBounds(raw));
    const values = readings(raw);
    if (mode === THERMOSTAT_MODE.AUTO) {
      const gap = Number(raw.deadband) > 0 ? Number(raw.deadband) : 0;
      const heat = kind === 'heat' ? setpoint : values.heatSetpoint;
      const cool = kind === 'cool' ? setpoint : values.coolSetpoint;
      if (heat !== null && cool !== null && heat > cool - gap) {
        throw this.fail(ACTION_TEXT.deadband, { gap });
      }
    }
    const change = kind === 'heat' ? { heatSetpoint: setpoint } : { coolSetpoint: setpoint };
    if (hold && isLcc(raw)) {
      change.hold = hold;
    }
    await this.write(thermostat, [buildUpdate(raw, change)]);
    const unit = unitOf(raw) === 'fahrenheit' ? '°F' : '°C';
    logger.info(`${this.label(thermostat)}: ${kind}ing setpoint set to ${setpoint} ${unit}`);
    return setpoint;
  }

  async setMode(thermostat, gladysMode) {
    if (!supportedModes(thermostat.raw).includes(gladysMode)) {
      throw this.fail(ACTION_TEXT.modeUnsupported);
    }
    const { steps, pauseMs } = modeWrites(thermostat.raw, gladysMode);
    await this.write(thermostat, steps, pauseMs);
    logger.info(`${this.label(thermostat)}: mode set to ${MODE_LABELS.en[gladysMode]}`);
  }

  async setHold(thermostat, option) {
    if (!isLcc(thermostat.raw)) {
      throw this.fail(ACTION_TEXT.holdUnsupported);
    }
    if (!SETTABLE_HOLDS.includes(option)) {
      throw this.fail(ACTION_TEXT.holdInApp);
    }
    await this.write(thermostat, [buildUpdate(thermostat.raw, { hold: HOLD_OPTIONS[option] })]);
    logger.info(`${this.label(thermostat)}: schedule set to "${holdLabel(option, 'en')}"`);
  }

  /** Send the writes in order, apply them to the states at once, confirm later. */
  async write(thermostat, steps, pauseMs = 0) {
    const client = this.requireClient();
    try {
      for (const [index, body] of steps.entries()) {
        if (index > 0 && pauseMs > 0) {
          await this.sleep(pauseMs);
        }
        await client.updateThermostat(thermostat.locationId, thermostat.raw.deviceID, body);
        thermostat.raw = applyUpdate(thermostat.raw, body);
      }
    } catch (err) {
      if (!(err instanceof ResideoError)) {
        throw err;
      }
      logger.warn(`${this.label(thermostat)}: command failed: ${err.message}`);
      throw this.fail(
        err.kind === ERROR_KINDS.REFUSED ? ACTION_TEXT.failed : STATUS_TEXT[err.kind],
      );
    } finally {
      await this.publishStates([thermostat]);
      this.scheduleConfirm();
    }
  }

  /**
   * The thermostats a scene action targets: one device, or all of them.
   * @param {string|null|undefined} deviceExternalId
   */
  targets(deviceExternalId) {
    if (!deviceExternalId) {
      if (this.thermostats.size === 0) {
        throw this.fail(ACTION_TEXT.noThermostat);
      }
      return [...this.thermostats.values()];
    }
    return [this.thermostatOf(deviceExternalId).thermostat];
  }

  // --- Reports -------------------------------------------------------------------------------

  /** "Test the connection": read now, one line per thermostat. */
  async testConnection() {
    if (this.config.callbackUrlInvalid) {
      throw this.fail(CONNECTION_TEXT.invalidCallback);
    }
    this.requireClient();
    await this.refresh();
    if (this.error) {
      throw this.fail(STATUS_TEXT[this.error.kind]);
    }
    if (this.thermostats.size === 0) {
      return CONNECTION_TEXT.noThermostat;
    }
    const message = {};
    for (const language of LANGS) {
      const lines = [...this.thermostats.values()].map((thermostat) => {
        const values = readings(thermostat.raw);
        const name = displayName(thermostat.raw);
        if (!values.alive) {
          return format(pick(REPORT_TEXT.offline, language), { name });
        }
        const unit = unitOf(thermostat.raw) === 'fahrenheit' ? '°F' : '°C';
        const parts = [
          format(pick(REPORT_TEXT.line, language), {
            name,
            temperature: values.temperature === null ? '?' : `${values.temperature} ${unit}`,
            mode: values.mode === null ? '?' : pick(MODE_LABELS, language)[values.mode],
          }),
        ];
        if (thermostat.rooms.length > 0) {
          parts.push(format(pick(REPORT_TEXT.rooms, language), { count: thermostat.rooms.length }));
        }
        return parts.join(', ');
      });
      message[language] = lines.join('\n');
    }
    return message;
  }
}
