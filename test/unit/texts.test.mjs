import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOCALE, LOCALES, findLocale, resolveTexts } from '../../src/texts.js';

const collect = () => {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
};

test('every built-in locale has the same keys as Japanese, with a function where Japanese has one', () => {
  const ja = LOCALES.ja;
  assert.equal(DEFAULT_LOCALE, 'ja');
  assert.deepEqual(Object.keys(LOCALES), ['ja', 'en', 'zh-CN', 'zh-TW', 'ko']);
  for (const [name, words] of Object.entries(LOCALES)) {
    assert.deepEqual(Object.keys(words).sort(), Object.keys(ja).sort(), name);
    for (const [key, value] of Object.entries(words)) {
      assert.equal(typeof value, typeof ja[key], `${name}.${key}`);
      if (typeof value === 'function') assert.equal(typeof value(2), 'string', `${name}.${key}`);
      else assert.notEqual(value.trim(), '', `${name}.${key}`);
    }
  }
});

test('a language tag finds its locale whatever its case, with "_" or a region; Chinese by script', () => {
  const cases = {
    ja: 'ja', JA: 'ja', 'ja-JP': 'ja', en: 'en', 'en-US': 'en', EN_gb: 'en', ko: 'ko', ko_KR: 'ko',
    zh: 'zh-CN', 'zh-CN': 'zh-CN', 'zh-cn': 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-SG': 'zh-CN', 'zh-Hans-CN': 'zh-CN',
    'zh-TW': 'zh-TW', zh_tw: 'zh-TW', 'zh-Hant': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh-Hant-HK': 'zh-TW',
    ' en ': 'en', fr: null, 'fr-FR': null, english: null,
  };
  for (const [tag, expected] of Object.entries(cases)) assert.equal(findLocale(tag), expected, tag);
});

test('the words follow locale; none, an empty one or an unknown one gives Japanese (the unknown one with a warning)', () => {
  assert.equal(resolveTexts('en', undefined, () => {}).search, 'Search');
  assert.equal(resolveTexts('zh-TW', undefined, () => {}).search, '搜尋');
  for (const locale of [undefined, null, '', '  ']) {
    const { warnings, warn } = collect();
    assert.equal(resolveTexts(locale, undefined, warn).search, '検索');
    assert.deepEqual(warnings, []);
  }
  const unknown = collect();
  assert.equal(resolveTexts('fr', undefined, unknown.warn).search, '検索');
  assert.equal(unknown.warnings.length, 1);
  assert.match(unknown.warnings[0], /locale "fr" is not built in/);
  const wrongType = collect();
  assert.equal(resolveTexts(1, undefined, wrongType.warn).search, '検索');
  assert.match(wrongType.warnings[0], /locale must be a string/);
});

test('texts replaces the words of its keys only; numbers and words go to its functions', () => {
  const { warnings, warn } = collect();
  const words = resolveTexts('ja', { search: '検索する！', chapters: (n) => `全${n}章`, noResults: (q) => `${q} なし` }, warn);
  assert.equal(words.search, '検索する！');
  assert.equal(words.chapters(3), '全3章');
  assert.equal(words.noResults('abc'), 'abc なし');
  assert.equal(words.searchLabel, 'ページを検索');
  assert.equal(words.childPages(2), '2ページ');
  assert.deepEqual(warnings, []);
  // Over another locale, and the built-in words are not changed
  assert.equal(resolveTexts('en', { next: 'Onward' }, () => {}).next, 'Onward');
  assert.equal(resolveTexts('en', undefined, () => {}).next, 'Next');
  assert.equal(LOCALES.ja.search, '検索');
});

test('texts entries that are not keys or of the wrong type are warned about and skipped', () => {
  const { warnings, warn } = collect();
  const words = resolveTexts('en', { nope: 'x', search: 1, chapters: '全章', next: () => 'x' }, warn);
  assert.equal(words.search, 'Search');
  assert.equal(words.chapters(2), '2 chapters');
  assert.equal(words.next, 'Next');
  assert.deepEqual(warnings, ['texts has no "nope".', 'texts.search must be a string.', 'texts.chapters must be a function.', 'texts.next must be a string.']);
  for (const texts of ['検索', ['a'], 3]) {
    const bad = collect();
    assert.equal(resolveTexts('ja', texts, bad.warn).search, '検索');
    assert.deepEqual(bad.warnings, ['texts must be an object.']);
  }
});

test('a texts function that throws or does not return a string gives the locale\'s words for that call', () => {
  const { warnings, warn } = collect();
  const words = resolveTexts('en', { chapters: () => { throw new Error('boom'); }, childPages: (n) => n }, warn);
  assert.equal(words.chapters(1), '1 chapter');
  assert.equal(words.childPages(4), '4 pages');
  assert.deepEqual(warnings, ['texts.chapters failed: boom', 'texts.childPages must return a string.']);
});
