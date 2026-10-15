// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// The Resideo tokens are NOT configuration: they live under /data
// (src/store.js), written by the OAuth2 flow.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Key of the `oauth2` field of the manifest (the "Connect" button). Stores no value.
export const OAUTH_FIELD = 'resideo_account';

export const DEFAULT_CONFIG = {
  consumer_key: '',
  consumer_secret: '',
  callback_url: '',
  language: 'fr',
};

/**
 * The callback URL typed for the pasted-code flow: an absolute http(s) URL,
 * without credentials. Anything else is ignored (the Connect button then uses
 * the address of Gladys).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function parseCallbackUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return null;
  }
  return url.href;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  return {
    consumerKey: text('consumer_key'),
    // The secret is used as typed, but surrounding blanks come from a copy-paste.
    consumerSecret: text('consumer_secret'),
    callbackUrl: parseCallbackUrl(source.callback_url),
    callbackUrlInvalid: text('callback_url') !== '' && !parseCallbackUrl(source.callback_url),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Whether the developer app credentials are filled in. */
export const hasCredentials = (config) => Boolean(config.consumerKey && config.consumerSecret);
