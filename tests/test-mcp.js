#!/usr/bin/env node
/**
 * Unit tests for the claude-tutor MCP server (mcp/handlers.js + mcp/server.js).
 * Run: node tests/test-mcp.js
 *
 * Uses a throwaway learning dir via CLAUDE_TUTOR_LEARNING_DIR — never touches
 * the real ~/.claude/learning. All fixture data is synthetic.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Must be set BEFORE requiring lib/store.js — it resolves the dir at load time.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-tutor-mcp-'));
process.env.CLAUDE_TUTOR_LEARNING_DIR = TMP;

const { handlers, assertValidProgress, requireSlug } = require('../mcp/handlers');
const { today } = require('../lib/store');

let pass = 0;
let fail = 0;

// Tests are queued and run sequentially — order matters, several rewrite the
// fixture on disk.
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

function section(title) {
  queue.push({ section: title });
}

async function run() {
  for (const item of queue) {
    if (item.section) { console.log(`\n${item.section}`); continue; }
    try {
      await item.fn();
      console.log(`  ✓ ${item.name}`);
      pass++;
    } catch (e) {
      console.log(`  ✗ ${item.name}`);
      console.log(`    ${e.message}`);
      fail++;
    }
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// Every tool handler is async and never throws — it resolves to a
// CallToolResult, using { isError: true } to report failure.
function call(name, args) {
  return handlers[name](args);
}

function payload(result) {
  return JSON.parse(result.content[0].text);
}

function text(result) {
  return result.content[0].text;
}

// --- Synthetic fixture ---

const YESTERDAY = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
const NEXT_YEAR = new Date(Date.now() + 365 * 86400000).toLocaleDateString('sv-SE');

function writeFixture() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, 'plans'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'progress'), { recursive: true });

  fs.writeFileSync(path.join(TMP, 'index.json'), JSON.stringify({
    topics: {
      widgets: {
        slug: 'widgets', displayName: 'Widget Engineering',
        planFile: 'plans/widgets-2026-01-01.json',
        progressFile: 'progress/widgets.json',
        quizzesTaken: 1, overallScore: 50,
      },
      gadgets: {
        slug: 'gadgets', displayName: 'Gadget Theory',
        planFile: 'plans/gadgets-2026-01-02.json',
        progressFile: 'progress/gadgets.json',
        quizzesTaken: 0,
      },
    },
  }, null, 2));

  fs.writeFileSync(path.join(TMP, 'plans', 'widgets-2026-01-01.json'), JSON.stringify({
    topic: 'Widget Engineering', slug: 'widgets', created: '2026-01-01',
    modules: [
      { id: 1, title: 'Sprockets', keyConcepts: ['sprocket', 'flange'] },
      { id: 2, title: 'Cogs', keyConcepts: ['cog'] },
    ],
  }, null, 2));

  fs.writeFileSync(path.join(TMP, 'plans', 'gadgets-2026-01-02.json'), JSON.stringify({
    topic: 'Gadget Theory', slug: 'gadgets', created: '2026-01-02',
    modules: [{ id: 1, title: 'Basics', keyConcepts: ['widgetry'] }],
  }, null, 2));

  fs.writeFileSync(path.join(TMP, 'progress', 'widgets.json'), JSON.stringify({
    topic: 'widgets',
    quizzes: [{
      date: '2026-01-05', module: 1, score: 1, total: 2, difficulty: 'adaptive',
      questions: [
        { format: 'mcq', concept: 'sprocket', correct: true },
        { format: 'mcq', concept: 'flange', correct: false },
      ],
    }],
    weakAreas: ['flange'], strongAreas: ['sprocket'], overallScore: 50,
    spacedRepetition: {
      sprocket: { easeFactor: 2.6, intervalDays: 1, repetitions: 1, nextReview: YESTERDAY },
      flange: { easeFactor: 1.7, intervalDays: 1, repetitions: 0, nextReview: NEXT_YEAR },
    },
  }, null, 2));
}

writeFixture();

// --- Read tools ---

section('Read tools:');

test('list_topics returns every registered topic', async () => {
  const data = payload(await call('list_topics', {}));
  assert(data.count === 2, `Expected 2 topics, got ${data.count}`);
  const slugs = data.topics.map(t => t.slug).sort();
  assert(slugs.join(',') === 'gadgets,widgets', `Unexpected slugs: ${slugs}`);
});

test('list_topics surfaces overallScore as a 0-100 percentage', async () => {
  const data = payload(await call('list_topics', {}));
  const widgets = data.topics.find(t => t.slug === 'widgets');
  assert(widgets.overallScore === 50, `Expected 50, got ${widgets.overallScore}`);
});

test('get_plan returns the plan for a known slug', async () => {
  const plan = payload(await call('get_plan', { slug: 'widgets' }));
  assert(plan.slug === 'widgets', `Wrong plan: ${plan.slug}`);
  assert(plan.modules.length === 2, `Expected 2 modules, got ${plan.modules.length}`);
});

test('get_plan errors (not throws) for an unknown slug', async () => {
  const r = await call('get_plan', { slug: 'nonexistent' });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('No learning plan found'), `Unexpected message: ${text(r)}`);
});

test('get_plan rejects a path-traversal slug', async () => {
  const r = await call('get_plan', { slug: '../../etc/passwd' });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('Invalid slug'), `Unexpected message: ${text(r)}`);
});

test('get_plan rejects a missing slug', async () => {
  const r = await call('get_plan', {});
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('slug is required'), `Unexpected message: ${text(r)}`);
});

test('get_progress returns quiz history', async () => {
  const prog = payload(await call('get_progress', { slug: 'widgets' }));
  assert(prog.quizzes.length === 1, `Expected 1 quiz, got ${prog.quizzes.length}`);
  assert(prog.weakAreas.includes('flange'), 'Expected flange in weakAreas');
});

test('get_progress errors for a topic with no progress file', async () => {
  const r = await call('get_progress', { slug: 'gadgets' });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('No progress recorded'), `Unexpected message: ${text(r)}`);
});

test('get_module_scores reports null for unquizzed modules', async () => {
  const scores = payload(await call('get_module_scores', { slug: 'widgets' }));
  assert(scores.length === 2, `Expected 2 modules, got ${scores.length}`);
  assert(scores[0].score === 50, `Module 1 should be 50, got ${scores[0].score}`);
  assert(scores[1].score === null, `Module 2 should be null, got ${scores[1].score}`);
});

test('get_due_reviews finds concepts past their nextReview date', async () => {
  const data = payload(await call('get_due_reviews', {}));
  assert(data.totalDue === 1, `Expected 1 due concept, got ${data.totalDue}`);
  assert(data.topics[0].concepts[0].concept === 'sprocket', 'Expected sprocket due');
});

test('get_due_reviews excludes concepts scheduled in the future', async () => {
  const data = payload(await call('get_due_reviews', {}));
  const concepts = data.topics.flatMap(t => t.concepts.map(c => c.concept));
  assert(!concepts.includes('flange'), 'flange is scheduled next year and must not be due');
});

test('get_due_reviews compares against the LOCAL date, not UTC', async () => {
  const data = payload(await call('get_due_reviews', {}));
  assert(data.asOf === today(), `asOf ${data.asOf} should equal local today() ${today()}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(data.asOf), `asOf not YYYY-MM-DD: ${data.asOf}`);
});

test('get_recommendations ranks due reviews first', async () => {
  const recs = payload(await call('get_recommendations', {}));
  assert(recs.length > 0, 'Expected recommendations');
  assert(recs[0].type === 'review', `Expected review first, got ${recs[0].type}`);
  assert(recs[0].priority === 1, `Expected priority 1, got ${recs[0].priority}`);
});

test('get_recommendations includes weak areas and unstarted modules', async () => {
  const recs = payload(await call('get_recommendations', {}));
  const types = recs.map(r => r.type);
  assert(types.includes('weak'), `Expected a weak rec, got ${types}`);
  assert(types.includes('start'), `Expected a start rec for gadgets, got ${types}`);
});

// --- Write tool: record_quiz_result ---

section('Write tool — record_quiz_result:');

test('records a quiz and persists it to progress/<slug>.json', async () => {
  writeFixture();
  const data = payload(await call('record_quiz_result', {
    slug: 'widgets',
    answers: [
      { concept: 'cog', correct: true },
      { concept: 'cog', correct: true },
    ],
  }));
  assert(data.saved === true, 'Expected saved: true');
  const onDisk = JSON.parse(fs.readFileSync(path.join(TMP, 'progress', 'widgets.json'), 'utf8'));
  assert(onDisk.quizzes.length === 2, `Expected 2 quizzes on disk, got ${onDisk.quizzes.length}`);
  assert(onDisk.quizzes[1].total === 2, 'New quiz should have total 2');
});

test('advances SM-2 per concept with a local-format nextReview', async () => {
  writeFixture();
  await call('record_quiz_result', { slug: 'widgets', answers: [{ concept: 'cog', correct: true }] });
  const onDisk = JSON.parse(fs.readFileSync(path.join(TMP, 'progress', 'widgets.json'), 'utf8'));
  const sr = onDisk.spacedRepetition.cog;
  assert(sr, 'Expected spacedRepetition.cog');
  assert(sr.repetitions === 1, `Expected repetitions 1, got ${sr.repetitions}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(sr.nextReview), `nextReview not local YYYY-MM-DD: ${sr.nextReview}`);
  assert(sr.nextReview > today(), 'nextReview should be in the future');
});

test('recomputes overallScore as a 0-100 percentage', async () => {
  writeFixture();
  const data = payload(await call('record_quiz_result', {
    slug: 'widgets',
    answers: [{ concept: 'cog', correct: true }, { concept: 'cog', correct: true }],
  }));
  // Fixture: sprocket 1/1, flange 0/1; plus cog 2/2 → 3/4 = 75
  assert(data.overallScore === 75, `Expected 75, got ${data.overallScore}`);
  assert(data.overallScore > 1, 'overallScore must be a percentage, never a fraction');
});

test('recomputes weak and strong areas', async () => {
  writeFixture();
  const data = payload(await call('record_quiz_result', {
    slug: 'widgets', answers: [{ concept: 'cog', correct: false }],
  }));
  assert(data.weakAreas.includes('cog'), `Expected cog weak, got ${data.weakAreas}`);
  assert(data.strongAreas.includes('sprocket'), `Expected sprocket strong, got ${data.strongAreas}`);
});

test('updates index.json with quiz count, score and lastActivity', async () => {
  writeFixture();
  await call('record_quiz_result', { slug: 'widgets', answers: [{ concept: 'cog', correct: true }] });
  const index = JSON.parse(fs.readFileSync(path.join(TMP, 'index.json'), 'utf8'));
  assert(index.topics.widgets.quizzesTaken === 2, `Expected 2, got ${index.topics.widgets.quizzesTaken}`);
  assert(index.topics.widgets.lastActivity === today(), `Expected ${today()}, got ${index.topics.widgets.lastActivity}`);
});

test('creates a progress file for a topic that has none', async () => {
  writeFixture();
  await call('record_quiz_result', { slug: 'gadgets', answers: [{ concept: 'widgetry', correct: true }] });
  const onDisk = JSON.parse(fs.readFileSync(path.join(TMP, 'progress', 'gadgets.json'), 'utf8'));
  assert(onDisk.topic === 'gadgets', `Expected topic gadgets, got ${onDisk.topic}`);
  assert(onDisk.overallScore === 100, `Expected 100, got ${onDisk.overallScore}`);
});

test('rejects an empty answers array', async () => {
  const r = await call('record_quiz_result', { slug: 'widgets', answers: [] });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('non-empty array'), `Unexpected message: ${text(r)}`);
});

test('rejects an answer missing a concept', async () => {
  const r = await call('record_quiz_result', { slug: 'widgets', answers: [{ correct: true }] });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('concept is required'), `Unexpected message: ${text(r)}`);
});

test('rejects a non-boolean correct flag', async () => {
  const r = await call('record_quiz_result', { slug: 'widgets', answers: [{ concept: 'cog', correct: 'yes' }] });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('must be a boolean'), `Unexpected message: ${text(r)}`);
});

test('rejects a path-traversal slug before writing anything', async () => {
  writeFixture();
  const before = fs.readdirSync(path.join(TMP, 'progress')).sort().join(',');
  const r = await call('record_quiz_result', { slug: '../evil', answers: [{ concept: 'cog', correct: true }] });
  assert(r.isError === true, 'Expected isError: true');
  const after = fs.readdirSync(path.join(TMP, 'progress')).sort().join(',');
  assert(before === after, `progress/ changed: ${before} -> ${after}`);
});

// --- Write tool: update_spaced_repetition ---

section('Write tool — update_spaced_repetition:');

test('advances a single concept without appending a quiz', async () => {
  writeFixture();
  const data = payload(await call('update_spaced_repetition', { slug: 'widgets', concept: 'sprocket', correct: true }));
  assert(data.saved === true, 'Expected saved: true');
  assert(data.spacedRepetition.repetitions === 2, `Expected repetitions 2, got ${data.spacedRepetition.repetitions}`);
  const onDisk = JSON.parse(fs.readFileSync(path.join(TMP, 'progress', 'widgets.json'), 'utf8'));
  assert(onDisk.quizzes.length === 1, `Quiz count should be unchanged, got ${onDisk.quizzes.length}`);
});

test('a wrong answer resets repetitions to 0', async () => {
  writeFixture();
  const data = payload(await call('update_spaced_repetition', { slug: 'widgets', concept: 'sprocket', correct: false }));
  assert(data.spacedRepetition.repetitions === 0, `Expected 0, got ${data.spacedRepetition.repetitions}`);
  assert(data.spacedRepetition.intervalDays === 1, `Expected interval 1, got ${data.spacedRepetition.intervalDays}`);
});

test('rejects a missing concept', async () => {
  const r = await call('update_spaced_repetition', { slug: 'widgets', correct: true });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('concept is required'), `Unexpected message: ${text(r)}`);
});

test('rejects a non-boolean correct flag', async () => {
  const r = await call('update_spaced_repetition', { slug: 'widgets', concept: 'cog', correct: 1 });
  assert(r.isError === true, 'Expected isError: true');
  assert(text(r).includes('correct is required'), `Unexpected message: ${text(r)}`);
});

// --- Validation guards (the enforce-paths.js hook does NOT cover MCP writes) ---

section('Validation guards (hook does not cover MCP writes):');

test('rejects overallScore as a 0-1 fraction', async () => {
  let caught = null;
  try { assertValidProgress({ topic: 'x', quizzes: [], overallScore: 0.85 }); } catch (e) { caught = e; }
  assert(caught, 'Expected a validation error for overallScore: 0.85');
  assert(caught.message.includes('percentage 0-100'), `Unexpected message: ${caught.message}`);
  assert(caught.message.includes('85'), 'Error should suggest the intended percentage');
});

test('accepts overallScore as a 0-100 percentage', async () => {
  assertValidProgress({ topic: 'x', quizzes: [], overallScore: 85 });
  assertValidProgress({ topic: 'x', quizzes: [], overallScore: 0 });
  assertValidProgress({ topic: 'x', quizzes: [], overallScore: 100 });
});

test('rejects an out-of-range overallScore', async () => {
  let caught = null;
  try { assertValidProgress({ topic: 'x', overallScore: 140 }); } catch (e) { caught = e; }
  assert(caught && caught.message.includes('between 0 and 100'), `Unexpected: ${caught && caught.message}`);
});

test('rejects a non-numeric overallScore', async () => {
  let caught = null;
  try { assertValidProgress({ topic: 'x', overallScore: '85' }); } catch (e) { caught = e; }
  assert(caught && caught.message.includes('must be a number'), `Unexpected: ${caught && caught.message}`);
});

test('rejects invented field names like quiz_history', async () => {
  let caught = null;
  try { assertValidProgress({ topic: 'x', quiz_history: [] }); } catch (e) { caught = e; }
  assert(caught, 'Expected a validation error for quiz_history');
  assert(caught.message.includes('quiz_history'), `Unexpected message: ${caught.message}`);
});

test('rejects plan fields leaking into progress', async () => {
  let caught = null;
  try { assertValidProgress({ topic: 'x', quizzes: [], modules: [] }); } catch (e) { caught = e; }
  assert(caught, 'Expected a validation error for modules in progress');
  assert(caught.message.includes('Plan fields found'), `Unexpected message: ${caught.message}`);
});

test('rejects a malformed spacedRepetition entry', async () => {
  let caught = null;
  try { assertValidProgress({ topic: 'x', spacedRepetition: { cog: 'soon' } }); } catch (e) { caught = e; }
  assert(caught && caught.message.includes('spacedRepetition.cog'), `Unexpected: ${caught && caught.message}`);
});

test('requireSlug rejects absolute paths, traversal and uppercase', async () => {
  for (const bad of ['/etc/passwd', '../x', 'Widgets', 'a b', '', null, 42]) {
    let caught = null;
    try { requireSlug(bad); } catch (e) { caught = e; }
    assert(caught, `Expected rejection for slug ${JSON.stringify(bad)}`);
  }
  assert(requireSlug('widgets-101') === 'widgets-101', 'Valid slug should pass through');
});

// --- stdout purity + server startup ---

section('stdio safety:');

test('no source file under mcp/ writes to stdout', async () => {
  const dir = path.join(__dirname, '..', 'mcp');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  assert(files.length > 0, 'Expected .js files under mcp/');
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert(!/console\.log\s*\(/.test(src), `${f} contains console.log — it would corrupt the JSON-RPC stream`);
    assert(!/process\.stdout\.write/.test(src), `${f} writes to process.stdout directly`);
  }
});

test('server emits nothing on stdout before a request, and logs to stderr', async () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], {
    input: '', encoding: 'utf8', timeout: 15000,
    env: { ...process.env, CLAUDE_TUTOR_LEARNING_DIR: TMP },
  });
  assert(r.stdout === '', `Expected empty stdout, got: ${JSON.stringify(r.stdout.slice(0, 200))}`);
  assert(r.stderr.includes('[claude-tutor]'), `Expected a stderr startup log, got: ${r.stderr.slice(0, 200)}`);
});

test('server answers initialize and tools/list with valid JSON-RPC on stdout', async () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map(m => JSON.stringify(m)).join('\n') + '\n';

  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'server.js')], {
    input: requests, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, CLAUDE_TUTOR_LEARNING_DIR: TMP },
  });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  assert(lines.length === 2, `Expected 2 responses, got ${lines.length}`);
  for (const line of lines) JSON.parse(line); // must be pure JSON — no stray prints
  const tools = JSON.parse(lines[1]).result.tools.map(t => t.name).sort();
  const expected = [
    'get_due_reviews', 'get_module_scores', 'get_plan', 'get_progress',
    'get_recommendations', 'list_topics', 'record_quiz_result', 'update_spaced_repetition',
  ];
  assert(tools.join(',') === expected.join(','), `Unexpected tool list: ${tools.join(',')}`);
});

test('every registered tool has a handler', async () => {
  const { TOOLS } = require('../mcp/server.js');
  for (const [name] of TOOLS) {
    assert(typeof handlers[name] === 'function', `No handler for tool ${name}`);
  }
  assert(TOOLS.length === Object.keys(handlers).length, 'TOOLS and handlers are out of sync');
});

// --- Run + cleanup + summary ---

run().then(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
});
