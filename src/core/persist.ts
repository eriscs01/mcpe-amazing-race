// Chunked persistence (spec §13): the whole State as JSON, split over world dynamic properties
// `race:s0…sN` with the chunk count in `race:n`. Reads go through a PropertyBag, so the same
// code runs against the world in game and against a Map in tests.
import { createState } from './state.js';
import { SCHEMA_VERSION } from './types.js';

import type { State } from './types.js';

export type PropertyValue = string | number;

/** The slice of world dynamic properties persistence needs. */
export interface PropertyBag {
  get: (key: string) => unknown;
  /** `undefined` removes the property. */
  set: (key: string, value: PropertyValue | undefined) => void;
}

/**
 * Spec: chunks of 30,000 characters or less. Measured in UTF-8 bytes, which also satisfies
 * that and stays under the 32,767 limit however the game counts (colour codes are 2 bytes).
 */
export const CHUNK_BYTES = 30_000;
export const COUNT_KEY = 'race:n';
export const chunkKey = (i: number): string => `race:s${i}`;

export type CorruptReason = 'badCount' | 'missingChunk' | 'badJson' | 'notObject'
  | 'badVersion' | 'newerSchema';

export type LoadResult = { kind: 'empty' }
  | { kind: 'loaded'; state: State }
  | { kind: 'corrupt'; reason: CorruptReason };

function utf8Bytes(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/** Splits on whole characters so no chunk ends in half a surrogate pair. */
export function splitChunks(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  let size = 0;
  let at = 0;
  for (const ch of text) {
    const bytes = utf8Bytes(ch.codePointAt(0) ?? 0);
    if (size + bytes > maxBytes) {
      chunks.push(text.slice(start, at));
      start = at;
      size = 0;
    }
    size += bytes;
    at += ch.length;
  }
  chunks.push(text.slice(start));
  return chunks;
}

const savedCount = (bag: PropertyBag): number => {
  const n = bag.get(COUNT_KEY);
  return typeof n === 'number' ? n : 0;
};

/**
 * Writes all chunks in one call. If a write throws part-way, the stored chunks can mix old
 * and new text until the session's next periodic retry rewrites them all.
 */
export function saveState(bag: PropertyBag, state: State): void {
  const chunks = splitChunks(JSON.stringify(state), CHUNK_BYTES);
  const previous = savedCount(bag);
  chunks.forEach((chunk, i) => bag.set(chunkKey(i), chunk));
  bag.set(COUNT_KEY, chunks.length);
  for (let i = chunks.length; i < previous; i += 1) bag.set(chunkKey(i), undefined);
}

const isObject = (v: unknown): v is Record<string, unknown> => (
  typeof v === 'object' && v !== null && !Array.isArray(v)
);

/**
 * Saves grow additively: a field missing from an older save takes its default, one level
 * deep for nested records such as `settings` and `leg`. Elements of arrays and maps (teams,
 * stops, players) are not filled: fields added to them later must be optional or read with `??`.
 */
function withDefaults(saved: Record<string, unknown>): State {
  const defaults: Record<string, unknown> = { ...createState(0) };
  const merged: Record<string, unknown> = { ...defaults, ...saved };
  for (const [key, value] of Object.entries(defaults)) {
    const stored = saved[key];
    if (isObject(value) && isObject(stored)) merged[key] = { ...value, ...stored };
  }
  return merged as unknown as State;
}

/** Never writes: an unreadable save is left exactly as found for diagnosis. */
export function loadState(bag: PropertyBag): LoadResult {
  const count = bag.get(COUNT_KEY);
  if (count === undefined) return { kind: 'empty' };
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return { kind: 'corrupt', reason: 'badCount' };
  }
  const chunks = Array.from({ length: count }, (_, i) => bag.get(chunkKey(i)));
  if (!chunks.every((c) => typeof c === 'string')) {
    return { kind: 'corrupt', reason: 'missingChunk' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(chunks.join(''));
  } catch {
    return { kind: 'corrupt', reason: 'badJson' };
  }
  if (!isObject(parsed)) return { kind: 'corrupt', reason: 'notObject' };
  const { v } = parsed;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return { kind: 'corrupt', reason: 'badVersion' };
  }
  if (v > SCHEMA_VERSION) return { kind: 'corrupt', reason: 'newerSchema' };
  return { kind: 'loaded', state: withDefaults(parsed) };
}
