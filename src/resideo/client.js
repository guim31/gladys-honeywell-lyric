// -----------------------------------------------------------------------------
// Client of the Resideo (Honeywell Home) cloud API, api.honeywellhome.com:
// OAuth2 authorization code with the consumer key and secret of the user's
// own developer app, then the v2 REST API (the `apikey` query parameter on
// every call, the bearer token in the header).
//
// The tokens are kept by a TokenStore (src/store.js) so a restart does not
// ask the user to sign in again. A refused token is refreshed once and the
// call retried (Home Assistant: "Honeywell appear to have issues keeping
// tokens saved"); a refused refresh means the user must connect again.
//
// Every failure is a ResideoError with a `kind` the hub maps to a message.
// Never log a token, the secret or a URL carrying the key: errors only carry
// the status and the code the API answered.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { httpRequest } from './http.js';
import { isPriorityUnsupported } from './model.js';

export const BASE_URL = 'https://api.honeywellhome.com';

export const ERROR_KINDS = Object.freeze({
  NOT_CONFIGURED: 'not_configured', // no consumer key / secret
  NOT_CONNECTED: 'not_connected', // never signed in, or the tokens were dropped
  AUTH: 'auth', // the refresh token or the app credentials were refused
  RATE_LIMIT: 'rate_limit', // 429: the quota of the developer app is spent
  UNREACHABLE: 'unreachable', // network, timeout, 5xx
  REFUSED: 'refused', // any other answer, e.g. a command the thermostat refuses
});

export class ResideoError extends Error {
  constructor(kind, message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'ResideoError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

// Seconds of margin before the expiry announced by the token endpoint.
const EXPIRY_MARGIN_MS = 120_000;

/** A short fingerprint of the consumer key: tokens belong to one developer app. */
export const fingerprint = (key) =>
  createHash('sha256').update(String(key)).digest('hex').slice(0, 16);

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** The error code of an answer, whatever its shape (Apigee fault, OAuth error...). */
function errorCode(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const code =
    body.code ??
    body.error ??
    body.ErrorCode ??
    body.fault?.detail?.errorcode ??
    body.fault?.faultstring ??
    null;
  return code === null ? null : String(code).slice(0, 80);
}

export class ResideoClient {
  /**
   * @param {object} options
   * @param {string} options.consumerKey
   * @param {string} options.consumerSecret
   * @param {object} options.tokens TokenStore (load / save / clear)
   * @param {Function} [options.request] HTTP seam (src/resideo/http.js)
   * @param {() => number} [options.now]
   */
  constructor({ consumerKey, consumerSecret, tokens, request = httpRequest, now = Date.now }) {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.tokens = tokens;
    this.request = request;
    this.now = now;
    this.session = null; // { accessToken, refreshToken, expiresAt }
    this.loaded = false;
    this.refreshing = null;
  }

  // --- OAuth2 --------------------------------------------------------------------

  /** The sign-in page of Resideo for this developer app. */
  authorizeUrl(redirectUri, state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.consumerKey,
      redirect_uri: redirectUri,
      // Resideo asks which app the account belongs to (Resideo or First Alert):
      // 1 is Resideo / Honeywell Home (Home Assistant api.py).
      appSelect: '1',
    });
    if (state) {
      params.set('state', state);
    }
    return `${BASE_URL}/oauth2/authorize?${params}`;
  }

  /** Exchange the code of the sign-in page for tokens, and keep them. */
  async exchangeCode(code, redirectUri) {
    const body = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    await this.keep(body);
  }

  async tokenRequest(form) {
    let response;
    try {
      response = await this.request(`${BASE_URL}/oauth2/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form).toString(),
      });
    } catch (err) {
      throw new ResideoError(ERROR_KINDS.UNREACHABLE, `Token request failed: ${err.message}`);
    }
    const body = parseJson(response.body);
    if (response.status === 200 && body?.access_token) {
      return body;
    }
    const code = errorCode(body);
    if (response.status === 429) {
      throw new ResideoError(ERROR_KINDS.RATE_LIMIT, 'Token request rate-limited', {
        status: 429,
        code,
      });
    }
    if (response.status >= 500) {
      throw new ResideoError(
        ERROR_KINDS.UNREACHABLE,
        `Token endpoint answered ${response.status}`,
        {
          status: response.status,
          code,
        },
      );
    }
    // 400 invalid_grant (code used or expired), 401 (key or secret refused)...
    throw new ResideoError(
      ERROR_KINDS.AUTH,
      `Token request refused (${response.status}${code ? ` ${code}` : ''})`,
      { status: response.status, code },
    );
  }

  async keep(body) {
    const seconds = Number(body.expires_in);
    const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1_800_000;
    this.session = {
      accessToken: String(body.access_token),
      // A refresh may come back without a new refresh token: keep the old one.
      refreshToken: body.refresh_token ? String(body.refresh_token) : this.session?.refreshToken,
      expiresAt: this.now() + lifetime,
    };
    this.loaded = true;
    await this.tokens.save({ app: fingerprint(this.consumerKey), ...this.session });
  }

  /** Load the saved tokens once; tokens of another developer app are dropped. */
  async load() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const saved = await this.tokens.load();
    if (
      saved &&
      saved.app === fingerprint(this.consumerKey) &&
      typeof saved.refreshToken === 'string' &&
      saved.refreshToken !== ''
    ) {
      this.session = {
        accessToken: typeof saved.accessToken === 'string' ? saved.accessToken : '',
        refreshToken: saved.refreshToken,
        expiresAt: Number(saved.expiresAt) || 0,
      };
    }
  }

  /** Whether tokens are known (signed in at least once with this app). */
  async isConnected() {
    await this.load();
    return Boolean(this.session?.refreshToken);
  }

  /** Forget the tokens (the user signs in again, or they were refused). */
  async forget() {
    this.session = null;
    this.loaded = true;
    await this.tokens.clear();
  }

  async accessToken({ force = false } = {}) {
    await this.load();
    if (!this.session?.refreshToken) {
      throw new ResideoError(ERROR_KINDS.NOT_CONNECTED, 'Not connected to Resideo');
    }
    if (
      !force &&
      this.session.accessToken &&
      this.now() < this.session.expiresAt - EXPIRY_MARGIN_MS
    ) {
      return this.session.accessToken;
    }
    // Concurrent calls share one refresh: a refresh token may be single-use.
    this.refreshing ??= this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: this.session.refreshToken,
    })
      .then((body) => this.keep(body))
      .finally(() => {
        this.refreshing = null;
      });
    await this.refreshing;
    return this.session.accessToken;
  }

  // --- API ------------------------------------------------------------------------------

  /**
   * One call of the v2 API. A 401 refreshes the token and retries once.
   * @returns {Promise<{ status: number, body: unknown }>}
   */
  async call(method, path, { query = {}, json, allow = [] } = {}) {
    const url = `${BASE_URL}/v2${path}?${new URLSearchParams({ apikey: this.consumerKey, ...query })}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.accessToken({ force: attempt > 0 });
      let response;
      try {
        response = await this.request(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(json === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: json === undefined ? undefined : JSON.stringify(json),
        });
      } catch (err) {
        throw new ResideoError(ERROR_KINDS.UNREACHABLE, `${method} ${path} failed: ${err.message}`);
      }
      const body = parseJson(response.body);
      if (response.status === 200 || response.status === 201 || response.status === 204) {
        return { status: response.status, body };
      }
      if (allow.some((accept) => accept(response.status, body))) {
        return { status: response.status, body };
      }
      const code = errorCode(body);
      if (response.status === 401 && attempt === 0) {
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new ResideoError(ERROR_KINDS.AUTH, `${method} ${path} refused (${response.status})`, {
          status: response.status,
          code,
        });
      }
      if (response.status === 429) {
        throw new ResideoError(ERROR_KINDS.RATE_LIMIT, `${method} ${path} rate-limited`, {
          status: 429,
          code,
        });
      }
      if (response.status >= 500) {
        throw new ResideoError(
          ERROR_KINDS.UNREACHABLE,
          `${method} ${path} answered ${response.status}`,
          {
            status: response.status,
            code,
          },
        );
      }
      throw new ResideoError(
        ERROR_KINDS.REFUSED,
        `${method} ${path} refused (${response.status}${code ? ` ${code}` : ''})`,
        { status: response.status, code },
      );
    }
    throw new ResideoError(ERROR_KINDS.AUTH, `${method} ${path} refused`);
  }

  /** Every location of the account, each with its devices (full payloads). */
  async getLocations() {
    const { body } = await this.call('GET', '/locations');
    return Array.isArray(body) ? body : [];
  }

  /**
   * The rooms of a T9/T10 thermostat, or null when it has none (its answer is
   * then a 400 GetPriorityFailed, Home Assistant coordinator.py).
   */
  async getPriority(locationId, deviceId) {
    const { status, body } = await this.call(
      'GET',
      `/devices/thermostats/${encodeURIComponent(deviceId)}/priority`,
      { query: { locationId: String(locationId) }, allow: [isPriorityUnsupported] },
    );
    return status === 200 && body && typeof body === 'object' ? body : null;
  }

  async updateThermostat(locationId, deviceId, body) {
    await this.call('POST', `/devices/thermostats/${encodeURIComponent(deviceId)}`, {
      query: { locationId: String(locationId) },
      json: body,
    });
  }
}
