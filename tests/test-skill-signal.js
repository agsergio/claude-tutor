#!/usr/bin/env node
/**
 * Unit tests for the skill-signal markdown parser.
 * Run: node tests/test-skill-signal.js
 */

const fs = require('fs');
const path = require('path');
const { parseSkillSignal } = require('../skills/dashboard/server/skill-signal');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'skill-signal.md'), 'utf8');
let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    fail++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function eq(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Happy path against the real fixture ---

console.log('\nParsing the real skill-signal.md fixture:');

test('parses the generation date', () => {
  const s = parseSkillSignal(FIXTURE);
  eq(s.date, '2026-08-21', 'date');
});

test('parses all Study next rows', () => {
  const s = parseSkillSignal(FIXTURE);
  eq(s.studyNext.length, 6, 'studyNext.length');
});

test('parses a full row (Service Mesh) field-for-field', () => {
  const s = parseSkillSignal(FIXTURE);
  const row = s.studyNext.find(r => r.skill === 'Service Mesh');
  assert(row, 'Service Mesh row missing');
  eq(row.rank, 8, 'rank');            // "#8" -> 8
  eq(row.freq, 20, 'freq');           // "20 postings" -> 20
  eq(row.stage, 'studying', 'stage');
  eq(row.gap, 0.3649, 'gap');
  eq(row.nextAction, 'sandbox demo: config_db.json workflow + CLI', 'nextAction');
});

test('strips # from market rank and " postings" from frequency', () => {
  const s = parseSkillSignal(FIXTURE);
  for (const row of s.studyNext) {
    assert(row.rank === null || typeof row.rank === 'number', `rank not numeric: ${row.rank}`);
    assert(row.freq === null || typeof row.freq === 'number', `freq not numeric: ${row.freq}`);
  }
  eq(s.studyNext[0].rank, 1, 'first row rank');
  eq(s.studyNext[0].freq, 57, 'first row freq');
});

test('does not include the table header row as a skill', () => {
  const s = parseSkillSignal(FIXTURE);
  assert(!s.studyNext.some(r => /^skill$/i.test(r.skill)), 'header row leaked into studyNext');
});

test('parses rising entries with rank movement', () => {
  const s = parseSkillSignal(FIXTURE);
  eq(s.rising.length, 4, 'rising.length');
  const edge = s.rising.find(r => r.skill === 'Edge Compute');
  assert(edge, 'Edge Compute row missing');
  eq(edge.rank, 15, 'rank');
  eq(edge.direction, 'up', 'direction');
  eq(edge.delta, 3, 'delta');
  eq(edge.prevRank, 18, 'prevRank');
  eq(edge.stage, 'not-started', 'stage');
});

test('parses the job-ready exclusion list', () => {
  const s = parseSkillSignal(FIXTURE);
  eq(s.jobReady.join('|'), 'Version Control|Caching / CDN|Unit Testing', 'jobReady');
});

// --- Em-dash placeholder mapping ---

console.log('\nPlaceholder (—) handling:');

test('maps — in Next action to null', () => {
  const s = parseSkillSignal(FIXTURE);
  const distsys = s.studyNext.find(r => r.skill === 'Distributed Systems');
  eq(distsys.nextAction, null, 'nextAction');
  const orch = s.studyNext.find(r => r.skill === 'Container Orchestration');
  eq(orch.nextAction, null, 'nextAction');
});

test('maps — in any column to null, not a string', () => {
  const md = [
    '# Skill signal — 2026-01-02',
    '## Study next',
    '| # | Skill | Market rank | Seen in | Stage | Gap | Next action |',
    '|---|---|---|---|---|---|---|',
    '| 1 | Thing | — | — | — | — | — |',
  ].join('\n');
  const s = parseSkillSignal(md);
  const row = s.studyNext[0];
  eq(row.skill, 'Thing', 'skill');
  eq(row.rank, null, 'rank');
  eq(row.freq, null, 'freq');
  eq(row.stage, null, 'stage');
  eq(row.gap, null, 'gap');
  eq(row.nextAction, null, 'nextAction');
});

// --- Fail-closed on malformed input ---

console.log('\nMalformed input degrades to empty (never throws):');

const badInputs = [
  ['empty string', ''],
  ['whitespace only', '   \n\n  '],
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['an object', {}],
  ['unrelated markdown', '# Hello\n\nJust some prose.\n'],
  ['heading but no table', '# Skill signal — 2026-08-21\n\n## Study next\n\n'],
  ['table header only, no rows', '# Skill signal — 2026-08-21\n## Study next\n| # | Skill | Market rank | Seen in | Stage | Gap | Next action |\n|---|---|---|---|---|---|---|\n'],
  ['truncated mid-table', '# Skill signal — 2026-08-21\n## Study next\n| # | Skill | Market rank |'],
  ['HTML instead of markdown', '<html><body>404 Not Found</body></html>'],
];

for (const [label, input] of badInputs) {
  test(`${label} -> null`, () => {
    let result;
    try {
      result = parseSkillSignal(input);
    } catch (e) {
      throw new Error(`threw instead of failing closed: ${e.message}`);
    }
    eq(result, null, 'result');
  });
}

test('truncated fixture (half a file) never throws', () => {
  for (let i = 0; i < FIXTURE.length; i += 37) {
    const slice = FIXTURE.slice(0, i);
    let r;
    try {
      r = parseSkillSignal(slice);
    } catch (e) {
      throw new Error(`threw at offset ${i}: ${e.message}`);
    }
    assert(r === null || Array.isArray(r.studyNext), `bad shape at offset ${i}`);
  }
});

test('rows missing a skill name are dropped, not half-rendered', () => {
  const md = [
    '# Skill signal — 2026-01-02',
    '## Study next',
    '| # | Skill | Market rank | Seen in | Stage | Gap | Next action |',
    '|---|---|---|---|---|---|---|',
    '| 1 |  | #3 | 5 postings | studying | 0.1 | do it |',
    '| 2 | Real Skill | #4 | 6 postings | studying | 0.2 | do that |',
  ].join('\n');
  const s = parseSkillSignal(md);
  eq(s.studyNext.length, 1, 'studyNext.length');
  eq(s.studyNext[0].skill, 'Real Skill', 'skill');
});

test('missing rising / job-ready sections yield empty arrays', () => {
  const md = [
    '# Skill signal — 2026-01-02',
    '## Study next',
    '| # | Skill | Market rank | Seen in | Stage | Gap | Next action |',
    '|---|---|---|---|---|---|---|',
    '| 1 | Thing | #3 | 5 postings | studying | 0.1 | do it |',
  ].join('\n');
  const s = parseSkillSignal(md);
  eq(s.rising.length, 0, 'rising.length');
  eq(s.jobReady.length, 0, 'jobReady.length');
  eq(s.date, '2026-01-02', 'date');
});

test('missing date heading still parses the table', () => {
  const md = [
    '## Study next',
    '| # | Skill | Market rank | Seen in | Stage | Gap | Next action |',
    '|---|---|---|---|---|---|---|',
    '| 1 | Thing | #3 | 5 postings | studying | 0.1 | do it |',
  ].join('\n');
  const s = parseSkillSignal(md);
  eq(s.date, null, 'date');
  eq(s.studyNext.length, 1, 'studyNext.length');
});

// --- Summary ---

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
