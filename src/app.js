// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring. (Pattern of guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { LyricHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { TokenStore } from './store.js';
import { INIT_FAILED } from './texts.js';

const logger = createLogger({ name: 'lyric-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: tokens, request, timers, timings, now, sleep
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new LyricHub({
    gladys,
    tokens: options.tokens ?? new TokenStore(),
    request: options.request,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
    sleep: options.sleep,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first reading is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(
    whenReady(async (device, feature, value) => {
      await hub.setValue(device, feature, value);
    }),
  );

  // The devices are published with should_poll: false (the hub reads the
  // cloud on its own timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady(() => hub.pollDevice()));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((newConfig) => hub.reconfigure(normalizeConfig(newConfig))));

  gladys.onOAuthAuthorizeUrl(whenReady((key, redirectUri) => hub.authorizeUrl(key, redirectUri)));

  gladys.onOAuthCallback(whenReady((key, payload) => hub.oauthCallback(key, payload)));

  gladys.onAction(
    'test_connection',
    whenReady(() => hub.testConnection()),
  );

  gladys.onAction(
    'paste_code',
    whenReady((fields) => hub.pasteCode(fields)),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
