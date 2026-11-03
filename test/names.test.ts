// Place names (spec §5): from the terrain's table, never repeated within a course.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TERRAIN_NAMES } from '../src/core/config.js';
import { placeName } from '../src/core/course/names.js';
import { Rng } from '../src/core/rng.js';

test('a name is a prefix and suffix from the stop\'s terrain', () => {
  const [prefix, suffix] = placeName('desert', new Set(), new Rng(1)).split(' ');
  assert.ok(TERRAIN_NAMES.desert.prefixes.includes(prefix ?? ''));
  assert.ok(TERRAIN_NAMES.desert.suffixes.includes(suffix ?? ''));
});

test('names already used are not given again', () => {
  const rng = new Rng(2);
  const used = new Set<string>();
  const { prefixes, suffixes } = TERRAIN_NAMES.swamp;
  for (let i = 0; i < prefixes.length * suffixes.length; i += 1) {
    const name = placeName('swamp', used, rng);
    assert.ok(!used.has(name), name);
    used.add(name);
  }
});

test('once a terrain\'s names run out, another terrain\'s unused name is given', () => {
  const { prefixes, suffixes } = TERRAIN_NAMES.plains;
  const used = new Set(prefixes.flatMap((p) => suffixes.map((s) => `${p} ${s}`)));
  const name = placeName('plains', used, new Rng(3));
  assert.ok(!used.has(name));
  assert.ok(!prefixes.includes(name.split(' ')[0] ?? ''));
});
