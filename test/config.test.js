import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  hasCredentials,
  normalizeConfig,
  parseCallbackUrl,
} from '../src/config.js';

test('defaults: no credentials, French names', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, {
    consumerKey: '',
    consumerSecret: '',
    callbackUrl: null,
    callbackUrlInvalid: false,
    language: 'fr',
  });
  assert.equal(hasCredentials(config), false);
  assert.equal(normalizeConfig(DEFAULT_CONFIG).language, 'fr');
});

test('blanks around the pasted key and secret are dropped', () => {
  const config = normalizeConfig({
    consumer_key: ' key \n',
    consumer_secret: '\tsecret ',
    language: 'es',
  });
  assert.equal(config.consumerKey, 'key');
  assert.equal(config.consumerSecret, 'secret');
  assert.equal(config.language, 'es');
  assert.equal(hasCredentials(config), true);
});

test('an unknown language falls back to French', () => {
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});

test('the callback URL: absolute http(s), no credentials', () => {
  assert.equal(parseCallbackUrl('https://localhost/'), 'https://localhost/');
  assert.equal(parseCallbackUrl(' https://localhost '), 'https://localhost/');
  assert.equal(parseCallbackUrl('localhost'), null);
  assert.equal(parseCallbackUrl('ftp://localhost/'), null);
  assert.equal(parseCallbackUrl('https://user:pw@localhost/'), null);
  assert.equal(parseCallbackUrl(''), null);
  assert.equal(normalizeConfig({ callback_url: 'nope' }).callbackUrlInvalid, true);
  assert.equal(normalizeConfig({ callback_url: '' }).callbackUrlInvalid, false);
});
