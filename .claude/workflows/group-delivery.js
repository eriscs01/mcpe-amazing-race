export const meta = {
  name: 'group-delivery',
  description: 'Research, plan (advisor-reviewed), implement test-first, verify, review and completeness-check one unit of work; stops before the PR',
  whenToUse: 'One implementation group or cleanup batch for the Amazing Race add-on. Pass args {task, issues?, branch?}. The main session opens the PR, merges and cleans up.',
  phases: [
    { title: 'Research', detail: 'explorers: spec and design, code, follow-up issues' },
    { title: 'Plan', detail: 'planner, then advisor review, one revision' },
    { title: 'Implement', detail: 'test first, then code, committed on a branch' },
    { title: 'Verify', detail: 'typecheck, lint, coverage, package; fix until green' },
    { title: 'Review', detail: 'isolated reviewer in a worktree, then fixes' },
    { title: 'Completeness', detail: 'advisor checks the final diff against the plan' },
  ],
}

// args: { task: string, issues?: number[], branch?: string }
const task = args && args.task
if (!task) throw new Error('args.task is required, e.g. {task: "G19 ...", issues: [65, 33]}')
const issues = (args.issues || []).map((n) => `#${n}`).join(', ')
const context = `Task: ${task}${issues ? `\nFollow-up issues to consider taking in: ${issues}` : ''}`
const branch = args.branch || 'a branch named for the task (feat/... or chore/...) from the latest main'

const FACTS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, note: { type: 'string' } },
        required: ['path', 'note'],
      },
    },
  },
  required: ['summary', 'facts'],
}
const PLAN = {
  type: 'object',
  properties: {
    scope: { type: 'string' },
    modules: { type: 'array', items: { type: 'string' } },
    testsFirst: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    takenIn: { type: 'array', items: { type: 'string' } },
    deferred: { type: 'array', items: { type: 'string' } },
  },
  required: ['scope', 'modules', 'testsFirst', 'decisions', 'takenIn', 'deferred'],
}
const ADVICE = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['STOP', 'GO_WITH_CHANGES', 'GO'] },
    changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'changes'],
}
const IMPL = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    committed: { type: 'boolean' },
  },
  required: ['branch', 'summary', 'filesChanged', 'committed'],
}
const CHECKS = {
  type: 'object',
  properties: {
    typecheck: { type: 'boolean' },
    lint: { type: 'boolean' },
    coverage: { type: 'boolean' },
    pkg: { type: 'boolean' },
    failures: { type: 'string' },
  },
  required: ['typecheck', 'lint', 'coverage', 'pkg', 'failures'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          where: { type: 'string' },
          issue: { type: 'string' },
        },
        required: ['severity', 'where', 'issue'],
      },
    },
  },
  required: ['verdict', 'findings'],
}
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GO', 'GO_WITH_CHANGES', 'STOP'] },
    gaps: { type: 'array', items: { type: 'string' } },
    closes: { type: 'array', items: { type: 'string' } },
    leaveOpen: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'gaps', 'closes', 'leaveOpen'],
}

const RULES = 'Follow CLAUDE.md and the test-driven-development, design-principles and debuggability skills. '
  + 'The spec (docs/amazing-race-addon-spec.md) wins on behaviour, docs/technical-design.md on structure. '
  + 'Core never imports @minecraft/*. Stable APIs only.'

// ── Research: independent readers, no edits ─────────────────────────────────────────────────
phase('Research')
const lenses = [
  ['spec', 'Read the spec sections and docs/technical-design.md rows (§2 conventions, §3 decisions, §4 scope) that this task touches.'],
  ['code', 'Find the code and tests this task builds on or changes: path:line facts, signatures, helpers and existing test files.'],
  ['issues', 'Read the open GitHub issues labelled follow-up (use `gh api repos/eriscs01/mcpe-amazing-race/issues`; GraphQL is blocked). Mark each fits / maybe / no for this task, with a reason.'],
]
const research = (await parallel(lenses.map(([key, ask]) => () => agent(
  `${context}\n\n${ask}\nRead only; report terse path:line facts.`,
  { label: `research:${key}`, phase: 'Research', agentType: 'explorer', schema: FACTS },
)))).filter(Boolean)
const brief = research.map((r) => `${r.summary}\n${r.facts.map((f) => `- ${f.path}: ${f.note}`).join('\n')}`).join('\n\n')

// ── Plan: draft, advisor review, one revision ───────────────────────────────────────────────
phase('Plan')
let plan = await agent(
  `${context}\n\nResearch:\n${brief}\n\n${RULES}\nWrite a short plan: scope, modules and types, tests to write first, decisions needed (technical design §3), follow-up issues taken in or deferred with a reason. Stay inside the task's scope.`,
  { label: 'plan', phase: 'Plan', schema: PLAN },
)
const advice = await agent(
  `Plan review (checkpoint 1). Verify the plan against the code and docs; answer STOP, GO_WITH_CHANGES or GO with ranked concrete changes. Be terse.\n\n${context}\n\nPlan:\n${JSON.stringify(plan, null, 2)}`,
  { label: 'advisor:plan', phase: 'Plan', agentType: 'advisor', schema: ADVICE },
)
if (advice.verdict === 'STOP') {
  return { stopped: 'plan', advice, plan }
}
if (advice.verdict === 'GO_WITH_CHANGES') {
  plan = await agent(
    `Revise the plan to apply every change below. Return the full revised plan.\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nChanges:\n${advice.changes.map((c) => `- ${c}`).join('\n')}`,
    { label: 'plan:revise', phase: 'Plan', schema: PLAN },
  )
}
log(`plan: ${advice.verdict}; ${plan.modules.length} modules, ${plan.testsFirst.length} tests first`)

// ── Implement: one agent, since the edits are sequential and share files ────────────────────
phase('Implement')
const impl = await agent(
  `${context}\n\n${RULES}\nImplement this plan on ${branch}. Write the failing tests first, see them fail, then the code. Run \`npm run format\` after editing. Update docs/technical-design.md (§2/§3), CHANGELOG.md and docs/ingame-test.md. Commit everything (a worktree reviewer sees only committed work) with the attribution trailers from the session; do not push and do not open a PR.\n\nPlan:\n${JSON.stringify(plan, null, 2)}`,
  { label: 'implement', phase: 'Implement', schema: IMPL },
)

// ── Verify: the four CI checks, fix until green (at most 3 rounds) ──────────────────────────
phase('Verify')
let checks
for (let round = 1; round <= 3; round += 1) {
  checks = await agent(
    `On branch ${impl.branch}, run \`npm run typecheck\`, \`npm run lint\`, \`npm run coverage\` (core lines must stay at or above 80%) and \`npm run package\`. For any failure, fix the cause (never skip or weaken a test), run \`npm run format\`, re-run, and commit the fix. Report the final state of each check and any failure text still open.`,
    { label: `verify:${round}`, phase: 'Verify', schema: CHECKS },
  )
  if (checks.typecheck && checks.lint && checks.coverage && checks.pkg) break
}
if (!(checks.typecheck && checks.lint && checks.coverage && checks.pkg)) {
  return { stopped: 'checks', checks, impl, plan }
}

// ── Review: isolated reviewer, then fix what matters ───────────────────────────────────────
phase('Review')
const review = await agent(
  `Review the diff of ${impl.branch} against origin/main (committed work) against the spec, docs/technical-design.md, CLAUDE.md and the design-principles, debuggability and test-driven-development skills. Check correctness, persistence safety, exhaustiveness, logs and test quality. Return a verdict and ranked findings. Do not edit.\n\nPlan it implements:\n${JSON.stringify(plan, null, 2)}`,
  {
    label: 'review', phase: 'Review', agentType: 'reviewer', isolation: 'worktree', schema: REVIEW,
  },
)
const mustFix = review.findings.filter((f) => f.severity !== 'nit')
if (mustFix.length > 0) {
  await agent(
    `On branch ${impl.branch}, fix these review findings (skip any you can show is wrong and say why), then re-run typecheck, lint, coverage and package, \`npm run format\`, and commit.\n\n${mustFix.map((f) => `- [${f.severity}] ${f.where}: ${f.issue}`).join('\n')}`,
    { label: 'review:fix', phase: 'Review' },
  )
}

// ── Completeness: advisor checks the final diff against the plan ────────────────────────────
phase('Completeness')
const verdict = await agent(
  `Completeness check (checkpoint 3) for ${impl.branch} (diff vs origin/main). Check the diff covers every scope item and taken-in issue of the plan, that anything declined is recorded in docs, and that docs/CHANGELOG/ingame-test and tests are current and assert behaviour. Say which taken-in issues the PR should close and which stay open. Terse.\n\n${context}\n\nPlan:\n${JSON.stringify(plan, null, 2)}`,
  {
    label: 'advisor:completeness', phase: 'Completeness', agentType: 'advisor', schema: VERDICT,
  },
)
if (verdict.verdict !== 'GO') {
  await agent(
    `On branch ${impl.branch}, close these gaps, re-run typecheck, lint, coverage and package, \`npm run format\`, and commit.\n\n${verdict.gaps.map((g) => `- ${g}`).join('\n')}`,
    { label: 'completeness:fix', phase: 'Completeness' },
  )
}

// The main session pushes, opens the PR (summary, plan, `Closes #n`), watches CI, merges and cleans up.
return {
  branch: impl.branch,
  plan,
  checks,
  review: { verdict: review.verdict, fixed: mustFix, nits: review.findings.filter((f) => f.severity === 'nit') },
  completeness: verdict,
}
