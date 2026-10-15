// -----------------------------------------------------------------------------
// An in-memory Resideo API (api.honeywellhome.com), behind the `request` seam
// of the client: the OAuth2 token endpoint (Basic auth, authorization code and
// refresh token grants), GET /v2/locations, the priority endpoint of T9/T10
// thermostats and the thermostat writes. Payloads come from the fixtures of
// aiolyric and Home Assistant (test/fixtures/resideo/README.md).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const CONSUMER_KEY = 'FAKE-CONSUMER-KEY';
export const CONSUMER_SECRET = 'FAKE-CONSUMER-SECRET';

/** A fixture of test/fixtures/resideo, parsed afresh. */
export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/resideo/${name}.json`, import.meta.url), 'utf8'));

/** The default account: a T6 in Europe, a T9 and a Lyric Round in the US. */
export function defaultLocations() {
  const eu = { ...fixture('location-eu'), devices: [fixture('device-t6-celsius')] };
  const us = {
    locationID: 234567,
    name: 'Cabin',
    devices: [fixture('device-t9-fahrenheit'), fixture('device-round-tcc')],
  };
  return [eu, us];
}

export class FakeResideo {
  /**
   * @param {object} [options]
   * @param {() => number} [options.now]
   * @param {Array} [options.locations]
   * @param {Record<string, object>} [options.priorities] by deviceID
   * @param {boolean} [options.rotateRefresh] a refresh returns a new refresh token
   */
  constructor({ now = Date.now, locations, priorities, rotateRefresh = true } = {}) {
    this.now = now;
    this.locations = locations ?? defaultLocations();
    this.priorities = priorities ?? {
      'LCC-1f2e3d4c-5b6a-4f11-8a9b-0c1d2e3f4a5b': fixture('priority'),
    };
    this.rotateRefresh = rotateRefresh;
    this.codes = new Map(); // code -> redirect_uri
    this.accessTokens = new Map(); // token -> expiresAt
    this.refreshTokens = new Set();
    this.counter = 0;
    this.online = true;
    this.rateLimited = false;
    this.refuseWrites = false;
    this.requests = [];
    this.writes = [];
    this.request = (url, options) => this.handle(url, options);
  }

  /** A code the sign-in page would give for this redirect URI. */
  grantCode(redirectUri) {
    this.counter += 1;
    const code = `code-${this.counter}`;
    this.codes.set(code, redirectUri);
    return code;
  }

  /** Tokens as the token endpoint issues them (expires_in as a string, like Apigee). */
  issueTokens(lifetimeSeconds = 1799) {
    this.counter += 1;
    const access = `access-${this.counter}`;
    const refresh = `refresh-${this.counter}`;
    this.accessTokens.set(access, this.now() + lifetimeSeconds * 1000);
    this.refreshTokens.add(refresh);
    return {
      ...fixture('token'),
      access_token: access,
      refresh_token: refresh,
      expires_in: String(lifetimeSeconds),
    };
  }

  /** Every thermostat payload of the account, by deviceID. */
  device(deviceId) {
    for (const location of this.locations) {
      const found = (location.devices ?? []).find((device) => device.deviceID === deviceId);
      if (found) {
        return { location, device: found };
      }
    }
    return null;
  }

  count(path) {
    return this.requests.filter((request) => request.path === path).length;
  }

  async handle(url, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(url);
    this.requests.push({
      method,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      body,
    });
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (target.hostname !== 'api.honeywellhome.com') {
      return json(404, {});
    }
    if (target.pathname === '/oauth2/token') {
      return this.token(headers, body);
    }
    if (this.rateLimited) {
      return json(429, {
        fault: {
          faultstring: 'Rate limit quota violation. Quota limit exceeded.',
          detail: { errorcode: 'policies.ratelimit.QuotaViolation' },
        },
      });
    }
    if (target.searchParams.get('apikey') !== CONSUMER_KEY) {
      return json(401, { fault: { detail: { errorcode: 'oauth.v2.InvalidApiKey' } } });
    }
    const token = (headers.authorization ?? '').replace(/^Bearer /, '');
    const expiresAt = this.accessTokens.get(token);
    if (expiresAt === undefined || this.now() >= expiresAt) {
      return json(401, { fault: { detail: { errorcode: 'oauth.v2.InvalidAccessToken' } } });
    }
    if (method === 'GET' && target.pathname === '/v2/locations') {
      return json(200, this.locations);
    }
    const priority = target.pathname.match(/^\/v2\/devices\/thermostats\/([^/]+)\/priority$/);
    if (method === 'GET' && priority) {
      const found = this.priorities[decodeURIComponent(priority[1])];
      return found ? json(200, found) : json(400, fixture('priority-unsupported'));
    }
    const write = target.pathname.match(/^\/v2\/devices\/thermostats\/([^/]+)$/);
    if (method === 'POST' && write) {
      return this.write(decodeURIComponent(write[1]), target.searchParams.get('locationId'), body);
    }
    return json(404, { code: 404, message: 'Not found' });
  }

  token(headers, body) {
    const expected = `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')}`;
    if (headers.authorization !== expected) {
      return json(401, {
        fault: { detail: { errorcode: 'oauth.v2.InvalidApiKeyForGivenResource' } },
      });
    }
    const form = new URLSearchParams(body);
    if (form.get('grant_type') === 'authorization_code') {
      const redirect = this.codes.get(form.get('code'));
      if (!redirect || redirect !== form.get('redirect_uri')) {
        return json(400, { ErrorCode: 'invalid_request', Error: 'Invalid Authorization Code' });
      }
      this.codes.delete(form.get('code'));
      return json(200, this.issueTokens());
    }
    if (form.get('grant_type') === 'refresh_token') {
      const refresh = form.get('refresh_token');
      if (!this.refreshTokens.has(refresh)) {
        return json(400, { ErrorCode: 'invalid_request', Error: 'Invalid Refresh Token' });
      }
      const issued = this.issueTokens();
      if (this.rotateRefresh) {
        this.refreshTokens.delete(refresh);
        return json(200, issued);
      }
      this.refreshTokens.delete(issued.refresh_token);
      const { refresh_token: _dropped, ...withoutRefresh } = issued;
      return json(200, withoutRefresh);
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  write(deviceId, locationId, body) {
    const found = this.device(deviceId);
    if (!found || String(found.location.locationID) !== locationId) {
      return json(404, { code: 404, message: 'Device not found' });
    }
    const payload = JSON.parse(body);
    this.writes.push({ deviceId, body: payload });
    if (this.refuseWrites) {
      return json(400, { code: 400, message: 'Invalid setpoint' });
    }
    found.device.changeableValues = { ...found.device.changeableValues, ...payload };
    return json(200, null);
  }
}

function json(status, body) {
  return { status, body: body === null ? '' : JSON.stringify(body) };
}
