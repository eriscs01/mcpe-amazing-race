import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANAGRAMS, isCorrect, normalise, questionAt, TRIVIA,
} from '../src/core/quiz/bank.js';
import { answerValues } from '../src/core/quiz/form.js';

import type { FormField } from '../src/core/types.js';

describe('normalise (spec §7.1)', () => {
  it('lowercases and keeps letters and digits only', () => {
    assert.equal(normalise('  The Nether! '), 'thenether');
    assert.equal(normalise('Ender-Dragon'), 'enderdragon');
    assert.equal(normalise('1,024'), '1024');
    assert.equal(normalise('?!'), '');
  });
});

describe('the question bank', () => {
  it('has at least 30 trivia questions, each with a source and an answer', () => {
    assert.ok(TRIVIA.length >= 30);
    for (const t of TRIVIA) {
      assert.ok(t.prompt.length > 0 && t.source.length > 0 && t.answers.length > 0, t.prompt);
    }
  });

  it('has no repeated prompt and no empty or duplicate answer after normalising', () => {
    assert.equal(new Set(TRIVIA.map((t) => t.prompt)).size, TRIVIA.length);
    for (const t of TRIVIA) {
      const norm = t.answers.map(normalise);
      assert.ok(norm.every((n) => n.length > 0), t.prompt);
      assert.equal(new Set(norm).size, norm.length, t.prompt);
    }
  });

  it('accepts an answer in any case, with punctuation, or by an alias', () => {
    const q = { prompt: '?', accepted: ['diamond', 'diamonds'] };
    assert.ok(isCorrect(q, 'Diamond!'));
    assert.ok(isCorrect(q, ' DIAMONDS '));
    assert.ok(!isCorrect(q, 'dia mond s x'));
    assert.ok(!isCorrect(q, ''));
  });

  it('anagram words are lowercase letters and several are accepted by alias', () => {
    assert.ok(ANAGRAMS.length >= 20);
    for (const word of ANAGRAMS) assert.match(word.answers[0] ?? '', /^[a-z0-9 ]+$/);
  });
});

describe('questionAt', () => {
  it('is the same question for the same seed and index', () => {
    for (let i = 0; i < 12; i += 1) {
      assert.deepEqual(questionAt(777, i), questionAt(777, i));
    }
  });

  it('asks no trivia question twice in a deck', () => {
    const prompts = Array.from({ length: 12 }, (_, i) => questionAt(31, i).prompt);
    assert.equal(new Set(prompts).size, prompts.length);
  });

  it('draws about half trivia, a quarter arithmetic and a quarter anagrams', () => {
    const kinds = { trivia: 0, sum: 0, anagram: 0 };
    for (let seed = 0; seed < 400; seed += 1) {
      const { prompt } = questionAt(seed, 0);
      if (prompt.startsWith('Unscramble')) kinds.anagram += 1;
      else if (prompt.startsWith('What is')) kinds.sum += 1;
      else kinds.trivia += 1;
    }
    assert.ok(kinds.trivia > 160 && kinds.trivia < 240, JSON.stringify(kinds));
    assert.ok(kinds.sum > 70 && kinds.sum < 130, JSON.stringify(kinds));
    assert.ok(kinds.anagram > 70 && kinds.anagram < 130, JSON.stringify(kinds));
  });

  it('arithmetic questions have a correct integer answer', () => {
    let seen = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      const q = questionAt(seed, 0);
      const m = /^What is (\d+) ([+\-×]) (\d+)\?$/.exec(q.prompt);
      if (m) {
        seen += 1;
        const [a, b] = [Number(m[1]), Number(m[3])];
        const want = { '+': a + b, '-': a - b, '×': a * b }[m[2] ?? ''];
        assert.deepEqual(q.accepted, [String(want)]);
      }
    }
    assert.ok(seen > 30);
  });

  it('an anagram is not asked twice in one deck (#58)', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const answers = Array.from({ length: 40 }, (_, i) => questionAt(seed, i))
        .filter((q) => q.prompt.startsWith('Unscramble')).map((q) => q.accepted[0]);
      assert.equal(new Set(answers).size, answers.length, `seed ${seed}`);
    }
  });

  it('anagrams scramble the answer into something else', () => {
    let seen = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      const q = questionAt(seed, 0);
      const m = /^Unscramble this mob or item: (\w+)$/.exec(q.prompt);
      if (m) {
        seen += 1;
        const letters = (s: string): string => s.split('').sort().join('');
        const answer = q.accepted[0] ?? '';
        assert.notEqual(normalise(m[1] ?? ''), answer);
        assert.equal(letters(normalise(m[1] ?? '')), letters(answer));
      }
    }
    assert.ok(seen > 30);
  });
});

describe('answerValues', () => {
  const fields: FormField[] = [
    { type: 'text', label: 'q', placeholder: 'a' },
    { type: 'dropdown', label: 'Leg 1', options: ['x', 'y'] },
  ];

  it('returns the text and the chosen index, skipping undefined slots', () => {
    assert.deepEqual(answerValues(fields, [undefined, 'creeper', 1]), ['creeper', 1]);
  });

  it('is unreadable when the count, a type or an index is wrong', () => {
    assert.equal(answerValues(fields, ['a']), undefined);
    assert.equal(answerValues(fields, undefined), undefined);
    assert.equal(answerValues(fields, [1, 1]), undefined);
    assert.equal(answerValues(fields, ['a', 'b']), undefined);
    assert.equal(answerValues(fields, ['a', 2]), undefined);
    assert.equal(answerValues(fields, ['a', 0.5]), undefined);
    assert.equal(answerValues(fields, ['a', 0, 0]), undefined);
  });
});
