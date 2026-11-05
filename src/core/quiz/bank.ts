// The question bank (spec §7.1): verified trivia, arithmetic and mob/item anagrams, and how an
// answer is matched. Questions are pure functions of a seed and an index, so a team's question is
// never stored: the same save and seed ask the same one, and a test can replay any quiz.
import { Rng } from '../rng.js';

/** A question as asked: the prompt and every accepted answer, already normalised. */
export interface Question {
  prompt: string;
  accepted: string[];
}

interface Trivia {
  prompt: string;
  /** The answer and its aliases, as a person would type them. */
  answers: string[];
  /** Where the answer was checked (the Minecraft Wiki page, or the plain fact's origin). */
  source: string;
}

/** Spec §7.1: lowercase, letters and digits only. */
export const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

export const isCorrect = (question: Question, text: string): boolean => {
  const given = normalise(text);
  return given.length > 0 && question.accepted.includes(given);
};

/** The seed of one team's deck at one stop option; the same team and stop always ask the same. */
export function deckSeed(seed: number, teamId: string, stopId: number, option: string): number {
  const key = `${teamId}/${option}`;
  let h = (seed + stopId * 7919) % 4294967296;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 4294967296;
  return h;
}

const wiki = (page: string): string => `minecraft.wiki/w/${page}`;

/** At least 30 questions (spec §7.1). Each answer was checked against its source. */
export const TRIVIA: readonly Trivia[] = [
  {
    prompt: 'Which green mob explodes when it gets close to a player?',
    answers: ['creeper'],
    source: wiki('Creeper'),
  },
  {
    prompt: 'What is the fewest obsidian blocks that can frame a Nether portal (no corners)?',
    answers: ['10', 'ten'],
    source: wiki('Nether_portal'),
  },
  {
    prompt: 'What item do you feed a wolf to tame it?',
    answers: ['bone', 'bones'],
    source: wiki('Wolf'),
  },
  {
    prompt: 'Which dimension does the Ender Dragon live in?',
    answers: ['the end', 'end'],
    source: wiki('The_End'),
  },
  {
    prompt: 'Diamond gear is upgraded to netherite with a smithing template and which material?',
    answers: ['netherite ingot', 'netherite'],
    source: wiki('Netherite_upgrade'),
  },
  {
    prompt: 'How many hearts does a player have at full health?',
    answers: ['10', 'ten'],
    source: wiki('Health'),
  },
  {
    prompt: 'What is the stack size of most building blocks?',
    answers: ['64', 'sixty four'],
    source: wiki('Item_(entity)'),
  },
  {
    prompt: 'What do you get from smelting sand in a furnace?',
    answers: ['glass'],
    source: wiki('Glass'),
  },
  {
    prompt: 'Which tool mines stone fastest?',
    answers: ['pickaxe', 'a pickaxe'],
    source: wiki('Pickaxe'),
  },
  {
    prompt: 'What do you get from cooking raw beef?',
    answers: ['steak', 'cooked beef'],
    source: wiki('Steak'),
  },
  {
    prompt: 'Which mob drops ender pearls?',
    answers: ['enderman', 'an enderman', 'endermen'],
    source: wiki('Enderman'),
  },
  {
    prompt: 'How many planks does one log craft into?',
    answers: ['4', 'four'],
    source: wiki('Planks'),
  },
  {
    prompt: 'How many sticks do you get from crafting two planks?',
    answers: ['4', 'four'],
    source: wiki('Stick'),
  },
  {
    prompt: 'Which animal do you use shears on to get wool?',
    answers: ['sheep', 'a sheep'],
    source: wiki('Sheep'),
  },
  {
    prompt: 'Which villager profession uses a composter?',
    answers: ['farmer', 'a farmer'],
    source: wiki('Villager'),
  },
  {
    prompt: 'Which item lets you steer a pig while riding it?',
    answers: ['carrot on a stick'],
    source: wiki('Carrot_on_a_Stick'),
  },
  {
    prompt: 'Which block makes up the top row of a bed recipe (three of them)?',
    answers: ['wool', 'white wool', 'any wool'],
    source: wiki('Bed'),
  },
  {
    prompt: 'How many end portal frame blocks make up an end portal?',
    answers: ['12', 'twelve'],
    source: wiki('End_portal_frame'),
  },
  {
    prompt: 'By default, a compass points to the world\'s what?',
    answers: ['spawn', 'spawn point', 'world spawn'],
    source: wiki('Compass'),
  },
  {
    prompt: 'Which item do you use to light a Nether portal?',
    answers: ['flint and steel', 'flint steel', 'fire charge'],
    source: wiki('Flint_and_Steel'),
  },
  {
    prompt: 'Which golem is built from snow blocks and a carved pumpkin?',
    answers: ['snow golem', 'snowman'],
    source: wiki('Snow_Golem'),
  },
  {
    prompt: 'Which mob drops a trident?',
    answers: ['drowned', 'a drowned'],
    source: wiki('Drowned'),
  },
  {
    prompt: 'Which flying mob drops phantom membranes?',
    answers: ['phantom', 'a phantom', 'phantoms'],
    source: wiki('Phantom'),
  },
  {
    prompt: 'Which valuable gem is the usual currency for villager trades?',
    answers: ['emerald', 'emeralds'],
    source: wiki('Emerald'),
  },
  {
    prompt: 'Which tool digs dirt fastest?',
    answers: ['shovel', 'a shovel'],
    source: wiki('Shovel'),
  },
  {
    prompt: 'Which block do you use to craft on a 3 by 3 grid?',
    answers: ['crafting table'],
    source: wiki('Crafting_Table'),
  },
  {
    prompt: 'How many gold ingots surround the apple in a golden apple recipe?',
    answers: ['8', 'eight'],
    source: wiki('Golden_Apple'),
  },
  {
    prompt: 'Which Minecraft creator goes by the nickname "Notch"? Give a surname.',
    answers: ['persson', 'markus persson'],
    source: 'Mojang / Markus Persson',
  },
  {
    prompt: 'Which company bought Mojang in 2014?',
    answers: ['microsoft'],
    source: 'Microsoft press release, 2014-09-15',
  },
  {
    prompt: 'In a spider jockey, which mob rides the spider?',
    answers: ['skeleton', 'a skeleton'],
    source: wiki('Spider_Jockey'),
  },
  {
    prompt: 'Which dimension has lava seas and soul sand valleys?',
    answers: ['the nether', 'nether'],
    source: wiki('The_Nether'),
  },
  {
    prompt: 'Which item repairs an elytra in an anvil?',
    answers: ['phantom membrane', 'phantom membranes'],
    source: wiki('Elytra'),
  },
  {
    prompt: 'How many iron blocks are used to build an iron golem?',
    answers: ['4', 'four'],
    source: wiki('Iron_Golem'),
  },
  {
    prompt: 'Which mob drops a blaze rod?',
    answers: ['blaze', 'a blaze', 'blazes'],
    source: wiki('Blaze'),
  },
];

/** Mob and item names to unscramble; the first is the answer, the rest are aliases. */
export const ANAGRAMS: readonly { answers: string[] }[] = [
  // Only words with no other common word among their anagrams (not wolf: "flow"; not spider).
  'creeper', 'zombie', 'skeleton', 'enderman', 'villager', 'pillager', 'blaze', 'ghast', 'witch',
  'phantom', 'drowned', 'husk', 'piglin', 'hoglin', 'ocelot', 'allay', 'panda', 'camel', 'turtle',
  'zoglin', 'llama', 'guardian', 'pickaxe', 'diamond', 'emerald', 'redstone', 'compass',
].map((word) => ({ answers: [word] }));

const sum = (rng: Rng): Question => {
  const op = rng.pick(['+', '-', '×'] as const);
  if (op === '×') {
    const [a, b] = [rng.int(2, 12), rng.int(2, 12)];
    return { prompt: `What is ${a} × ${b}?`, accepted: [String(a * b)] };
  }
  const [x, y] = [rng.int(10, 99), rng.int(10, 99)];
  const [a, b] = op === '-' ? [Math.max(x, y) + 1, Math.min(x, y)] : [x, y];
  return { prompt: `What is ${a} ${op} ${b}?`, accepted: [String(op === '+' ? a + b : a - b)] };
};

const scramble = (word: string, rng: Rng): string => {
  for (let i = 0; i < 10; i += 1) {
    const out = rng.shuffle(word.split('')).join('');
    if (out !== word) return out;
  }
  return `${word.slice(1)}${word.charAt(0)}`;
};

/** An anagram not asked yet in this deck (all of them again once the list runs out). */
const anagram = (rng: Rng, used: Set<number>): Question => {
  const fresh = ANAGRAMS.map((_, n) => n).filter((n) => !used.has(n));
  const n = rng.pick(fresh.length > 0 ? fresh : ANAGRAMS.map((_, k) => k));
  used.add(n);
  const answers = ANAGRAMS[n]?.answers ?? [];
  const word = answers[0] ?? '';
  return {
    prompt: `Unscramble this mob or item: ${scramble(word, rng)}`,
    accepted: answers.map(normalise),
  };
};

/** The question at `index` of the deck for `seed`: half trivia, a quarter each of the rest. */
export function questionAt(seed: number, index: number): Question {
  const rng = new Rng(seed);
  const used = new Set<number>();
  const usedWords = new Set<number>();
  let question: Question = { prompt: '', accepted: [] };
  for (let i = 0; i <= index; i += 1) {
    const roll = rng.next();
    if (roll < 0.5) {
      // A trivia question is not asked twice in one deck, until the bank runs out.
      const fresh = TRIVIA.map((_, n) => n).filter((n) => !used.has(n));
      const pool = fresh.length > 0 ? fresh : TRIVIA.map((_, n) => n);
      const n = rng.pick(pool);
      used.add(n);
      const t = TRIVIA[n];
      question = { prompt: t?.prompt ?? '', accepted: (t?.answers ?? []).map(normalise) };
    } else if (roll < 0.75) {
      question = sum(rng);
    } else {
      question = anagram(rng, usedWords);
    }
  }
  return question;
}
