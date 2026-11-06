// Airbnb style (eslint-config-airbnb-extended) for TypeScript, with type-aware rules.
// Formatting is part of it (@stylistic rules); `npm run format` applies the fixable ones.
// Deviations from Airbnb are listed under `project/*` with the reason for each.
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import { configs, plugins, rules } from 'eslint-config-airbnb-extended';
import minecraftLinting from 'eslint-plugin-minecraft-linting';

const root = fileURLToPath(new URL('.', import.meta.url));

export default [
  {
    // Review agents' worktrees hold whole copies of the repo outside both tsconfigs.
    ignores: [
      '.claude/worktrees/**', '.claude/workflows/**', 'behavior_pack/scripts/**', 'build/**', 'dist/**', 'node_modules/**',
    ],
  },

  { name: 'js/recommended', ...js.configs.recommended },
  plugins.stylistic,
  plugins.importX,
  plugins.node,
  plugins.typescriptEslint,
  ...configs.base.recommended,
  rules.base.importsStrict,
  ...configs.node.recommended,
  ...configs.base.typescript,
  rules.typescript.typescriptEslintStrict,

  {
    name: 'project/type-info',
    languageOptions: {
      parserOptions: {
        // scripts/ and this file are plain Node ESM outside both tsconfigs.
        projectService: { allowDefaultProject: ['*.mjs', 'scripts/*.mjs'] },
        tsconfigRootDir: root,
      },
    },
  },
  {
    name: 'project/type-info-ts',
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: root,
      },
    },
  },

  {
    // Microsoft's Minecraft add-on lint: prefer a Script API over runCommand when one exists.
    name: 'minecraft/scripts',
    files: ['src/**/*.ts'],
    plugins: { 'minecraft-linting': minecraftLinting },
    rules: { 'minecraft-linting/avoid-unnecessary-command': 'error' },
  },

  {
    name: 'project/all',
    rules: {
      // Airbnb bans for...of to avoid regenerator-runtime when transpiling to ES5. We compile to
      // ES2022 and Bedrock runs it natively, so only the other restricted constructs stay banned.
      'no-restricted-syntax': [
        'error',
        { selector: 'ForInStatement', message: 'Use Object.keys/values/entries instead.' },
        { selector: 'LabeledStatement', message: 'Labels are a form of GOTO.' },
        { selector: 'WithStatement', message: '`with` is disallowed in strict mode.' },
      ],
      // Named exports keep one name per symbol across every import site.
      'import-x/prefer-default-export': 'off',
      // console.warn/error write to Bedrock's Content Log; plain logs are not shown there.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    name: 'project/scripts',
    files: ['scripts/**'],
    rules: {
      // Build CLIs: printing, synchronous I/O and exit codes are their job.
      'no-console': 'off',
      'n/no-sync': 'off',
      'n/no-process-exit': 'off',
    },
  },
  {
    name: 'project/tests',
    files: ['test/**'],
    rules: {
      // Test setup reads fixtures synchronously; the id test needs whole vanilla-data modules.
      'n/no-sync': 'off',
      'import-x/no-namespace': 'off',
    },
  },
];
