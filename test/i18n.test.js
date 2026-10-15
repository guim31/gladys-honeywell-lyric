// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, and the four documentation files, with the same
// sections. German says "du", never the polite "Sie". (Adapted from
// guim31/gladys-wled and guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { ERROR_KINDS } from '../src/resideo/client.js';
import { HOLD_OPTIONS } from '../src/resideo/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  HOLD_LABELS,
  INIT_FAILED,
  LANGS,
  MODE_LABELS,
  NAMES,
  REPORT_TEXT,
  STATUS_TEXT,
  format,
} from '../src/texts.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  featureName: 40,
  option: 40,
};

const sorted = (keys) => [...keys].sort();
const placeholders = (text) => sorted(text.match(/\{\w+\}/g) ?? []);

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
    if (typeof text === 'string' && typeof value.en === 'string') {
      if (JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(value.en))) {
        found.push(`${path}.${lang} does not have the placeholders of ${path}.en`);
      }
    }
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // Section texts are longer (up to 1000 characters for the core).
      const isSection = /^manifest\.config_schema\[\d+\]\.description$/.test(path);
      const max =
        path === 'manifest.description' ? MAX.catalog : isSection ? 1000 : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(value, `${name}.${lang}.${key}`, lang, max));
      if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(table.en[key]))) {
        found.push(`${name}.${lang}.${key} does not have the placeholders of English`);
      }
    }
  }
  return found;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 40, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog name is the same in every language, the description 10 characters at least', () => {
  assert.equal(typeof manifest.name, 'string');
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message table of the code has the four languages', () => {
  const found = [
    ...problems(INIT_FAILED, 'INIT_FAILED', MAX.message),
    ...Object.entries(STATUS_TEXT).flatMap(([key, value]) =>
      problems(value, `STATUS_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ACTION_TEXT).flatMap(([key, value]) =>
      problems(value, `ACTION_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(REPORT_TEXT).flatMap(([key, value]) =>
      problems(value, `REPORT_TEXT.${key}`, MAX.message),
    ),
  ];
  assert.deepEqual(found, []);
  // Every error kind but "not configured" (a status of its own) has a status text.
  assert.deepEqual(sorted(Object.keys(STATUS_TEXT)), sorted(Object.values(ERROR_KINDS)));
});

test('the feature names and option labels exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(MODE_LABELS, 'MODE_LABELS', MAX.option), []);
  assert.deepEqual(tableProblems(HOLD_LABELS, 'HOLD_LABELS', MAX.option), []);
  assert.deepEqual(Object.keys(HOLD_LABELS.en), Object.keys(HOLD_OPTIONS));
});

test('a room name fits the feature names', () => {
  for (const lang of LANGS) {
    for (const key of ['room_temperature', 'room_humidity', 'room_presence']) {
      const name = format(NAMES[lang][key], { room: 'Master Bedroom' });
      assert.ok(name.includes('Master Bedroom') && name.length <= 60, `${lang}.${key}`);
    }
  }
});

test('the guard catches a missing language, an empty text, the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: '{n} a', fr: 'a', de: '{n} a', es: '{n} a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[1].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[1].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

// How each documentation writes the room of a room sensor.
const ROOM = { en: '<room>', fr: '<pièce>', de: '<Raum>', es: '<habitación>' };

test('the four documentation files exist, with the same sections', () => {
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(headings(docs[lang]), headings(docs.en), `docs/${lang}.md sections`);
  }
  assert.ok(headings(docs.en).length >= 10);
});

test('the documentation names every trigger, action, feature and option', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    for (const item of [
      ...manifest.scene_triggers,
      ...manifest.scene_actions,
      ...manifest.actions,
    ]) {
      assert.ok(doc.includes(item.label[lang]), `docs/${lang}.md: "${item.label[lang]}"`);
    }
    for (const name of Object.values(NAMES[lang])) {
      const written = format(name, { room: ROOM[lang] });
      assert.ok(doc.includes(written), `docs/${lang}.md: feature "${written}"`);
    }
    for (const label of [
      ...Object.values(MODE_LABELS[lang]),
      ...Object.values(HOLD_LABELS[lang]),
    ]) {
      assert.ok(doc.includes(`\`${label}\``), `docs/${lang}.md: option "${label}"`);
    }
    assert.ok(
      doc.includes('https://my.gladysassistant.com/redirect/oauth'),
      `docs/${lang}.md: callback URL`,
    );
  }
});

test('the German documentation says "du"', () => {
  const polite = docs.de
    .split('\n')
    .filter((line) => !line.startsWith('`') && POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the documentation says it was developed without the hardware, and not affiliated', () => {
  assert.match(docs.en, /Developed without the hardware:\s+feedback welcome/);
  assert.match(docs.en, /not affiliated\s+with\s+Resideo\s+or\s+Honeywell/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /github\.com\/guim31\/gladys-honeywell-lyric\/issues/);
  }
});
