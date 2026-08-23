// Tool handler logic for the claude-tutor MCP server.
//
// Kept separate from server.js so it can be unit-tested without driving the
// stdio transport (see tests/test-mcp.js).
//
// Two rules every handler in here obeys:
//   1. NEVER write to stdout. stdio MCP is JSON-RPC over stdout; one
//      console.log corrupts the stream. Log with console.error only.
//   2. NEVER throw. An unhandled exception kills the server. Every handler is
//      wrapped by `safe()` and returns { content, isError } instead.
//
// And the one that matters most: the enforce-paths.js PreToolUse hook does NOT
// see MCP tool calls (it matches Write|Edit). Every guarantee it provides —
// correct paths, no plan/progress field crossover, overallScore as 0-100 —
// is re-enforced here by calling the validate.js validators before writeJson.

const path = require('path');
const {
  LEARNING_DIR, readJson, writeJson, getIndex, findPlanFile,
  today, progressPath, indexPath,
} = require('../lib/store');
const {
  validateProgress, updateSM2, computeWeakStrong, getModuleScores,
} = require('../lib/validate');

// --- Result helpers ---

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// A rejected input (bad slug, bad payload) rather than a bug. Logged without a
// stack trace, since the stack says nothing useful.
class ToolError extends Error {}

// Wraps a handler so a thrown exception becomes an error result rather than
// killing the process.
function safe(name, fn) {
  return async (args) => {
    try {
      return await fn(args || {});
    } catch (e) {
      const detail = e instanceof ToolError ? e.message : (e.stack || e.message);
      console.error(`[claude-tutor] ${name} rejected: ${detail}`);
      return err(`${name}: ${e.message}`);
    }
  };
}

// --- Shared guards ---

function requireSlug(slug) {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new ToolError('slug is required and must be a non-empty string');
  }
  // Defence in depth: the slug becomes a filename, so it must not escape
  // LEARNING_DIR. The hook would have caught a bad path; nothing else will.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new ToolError(`Invalid slug "${slug}": expected lowercase letters, digits and hyphens only`);
  }
  return slug;
}

// Validate a progress object against the same schema the hook enforces, and
// additionally check overallScore is a 0-100 percentage, not a 0-1 fraction.
function assertValidProgress(data) {
  const { valid, errors } = validateProgress(data);
  if (!valid) throw new ToolError(`Progress validation failed: ${errors.join('; ')}`);

  if (data.overallScore !== undefined && data.overallScore !== null) {
    const s = data.overallScore;
    if (typeof s !== 'number' || Number.isNaN(s)) {
      throw new ToolError('overallScore must be a number (percentage 0-100)');
    }
    if (s > 0 && s < 1) {
      throw new ToolError(`overallScore must be a percentage 0-100, not a fraction (got ${s}; did you mean ${Math.round(s * 100)}?)`);
    }
    if (s < 0 || s > 100) {
      throw new ToolError(`overallScore must be between 0 and 100 (got ${s})`);
    }
  }
  return data;
}

// Every write goes through here: validate, then persist.
function saveProgress(slug, progress) {
  assertValidProgress(progress);
  const file = progressPath(slug);
  if (path.dirname(file) !== path.join(LEARNING_DIR, 'progress')) {
    throw new ToolError(`Refusing to write outside ${path.join(LEARNING_DIR, 'progress')}`);
  }
  writeJson(file, progress);
  return file;
}

function touchIndex(slug, progress) {
  const index = getIndex();
  if (!index.topics || !index.topics[slug]) return false;
  index.topics[slug].quizzesTaken = (progress.quizzes || []).length;
  index.topics[slug].overallScore = progress.overallScore;
  index.topics[slug].lastActivity = today();
  writeJson(indexPath(), index);
  return true;
}

function loadProgress(slug) {
  return readJson(progressPath(slug)) || { topic: slug, quizzes: [], spacedRepetition: {} };
}

function dueConcepts(progress, asOf) {
  return Object.entries(progress?.spacedRepetition || {})
    .filter(([, sr]) => sr && sr.nextReview && sr.nextReview <= asOf)
    .map(([concept, sr]) => ({ concept, nextReview: sr.nextReview, intervalDays: sr.intervalDays }));
}

// --- Read tools ---

const list_topics = safe('list_topics', async () => {
  const index = getIndex();
  const topics = Object.entries(index.topics || {}).map(([slug, t]) => ({
    slug,
    displayName: t.displayName || slug,
    level: t.level || null,
    quizzesTaken: t.quizzesTaken ?? 0,
    overallScore: t.overallScore ?? null,
    lastActivity: t.lastActivity || null,
  }));
  return ok({ count: topics.length, topics });
});

const get_plan = safe('get_plan', async ({ slug }) => {
  requireSlug(slug);
  const file = findPlanFile(slug);
  if (!file) return err(`No learning plan found for "${slug}". Use list_topics to see available topics.`);
  const plan = readJson(file);
  if (!plan) return err(`Plan file for "${slug}" could not be read.`);
  return ok(plan);
});

const get_progress = safe('get_progress', async ({ slug }) => {
  requireSlug(slug);
  const progress = readJson(progressPath(slug));
  if (!progress) return err(`No progress recorded yet for "${slug}".`);
  return ok(progress);
});

const get_module_scores = safe('get_module_scores', async ({ slug }) => {
  requireSlug(slug);
  const file = findPlanFile(slug);
  if (!file) return err(`No learning plan found for "${slug}".`);
  const plan = readJson(file);
  const progress = readJson(progressPath(slug)) || { quizzes: [] };
  return ok(getModuleScores(plan, progress));
});

const get_due_reviews = safe('get_due_reviews', async () => {
  const asOf = today();
  const index = getIndex();
  const results = [];
  for (const [slug, topic] of Object.entries(index.topics || {})) {
    const progress = readJson(path.join(LEARNING_DIR, topic.progressFile || `progress/${slug}.json`));
    const due = dueConcepts(progress, asOf);
    if (due.length > 0) {
      results.push({ slug, topic: topic.displayName || slug, dueCount: due.length, concepts: due });
    }
  }
  const totalDue = results.reduce((n, r) => n + r.dueCount, 0);
  return ok({ asOf, totalDue, topics: results });
});

// Ported from GET /api/recommendations (skills/dashboard/server/api.js).
const get_recommendations = safe('get_recommendations', async () => {
  const index = getIndex();
  const asOf = today();
  const recs = [];

  for (const [slug, topic] of Object.entries(index.topics || {})) {
    const prog = readJson(path.join(LEARNING_DIR, topic.progressFile || `progress/${slug}.json`));
    const name = topic.displayName || slug;

    const due = dueConcepts(prog, asOf).map(d => d.concept);
    if (due.length > 0) {
      recs.push({ type: 'review', slug, topic: name, message: `${due.length} concept(s) due for review`, concepts: due, priority: 1 });
    }

    if (prog?.weakAreas?.length > 0) {
      recs.push({ type: 'weak', slug, topic: name, message: `Focus on weak areas: ${prog.weakAreas.join(', ')}`, priority: 2 });
    }

    const planFile = findPlanFile(slug);
    const plan = planFile ? readJson(planFile) : null;
    if (plan && prog) {
      const unstarted = getModuleScores(plan, prog).find(m => m.score === null);
      if (unstarted) {
        recs.push({ type: 'module', slug, topic: name, message: `Start Module ${unstarted.moduleId}: ${unstarted.title}`, moduleId: unstarted.moduleId, priority: 3 });
      }
    }

    if (!prog && topic.quizzesTaken === 0) {
      recs.push({ type: 'start', slug, topic: name, message: 'Take your first quiz!', priority: 4 });
    }
  }

  if (Object.keys(index.topics || {}).length > 0 && recs.length === 0) {
    recs.push({ type: 'complete', message: 'Great work! All topics are strong. Consider learning something new.', priority: 5 });
  }

  recs.sort((a, b) => a.priority - b.priority);
  return ok(recs);
});

// --- Write tools ---

// Mirrors POST /api/quiz/submit.
const record_quiz_result = safe('record_quiz_result', async ({ slug, answers, module: moduleId }) => {
  requireSlug(slug);
  if (!Array.isArray(answers) || answers.length === 0) {
    return err('answers must be a non-empty array of { concept, correct, format? }');
  }
  for (const [i, a] of answers.entries()) {
    if (!a || typeof a.concept !== 'string' || a.concept.trim() === '') {
      return err(`answers[${i}].concept is required and must be a non-empty string`);
    }
    if (typeof a.correct !== 'boolean') {
      return err(`answers[${i}].correct is required and must be a boolean`);
    }
  }

  // Re-read immediately before writing to narrow the read-modify-write race
  // with the dashboard server.
  const progress = loadProgress(slug);
  if (!Array.isArray(progress.quizzes)) progress.quizzes = [];
  const date = today();

  const score = answers.filter(a => a.correct).length;
  progress.quizzes.push({
    date,
    module: moduleId ?? null,
    score,
    total: answers.length,
    difficulty: 'adaptive',
    questions: answers.map(a => ({ format: a.format || 'mcq', concept: a.concept, correct: a.correct })),
  });

  if (!progress.spacedRepetition) progress.spacedRepetition = {};
  for (const a of answers) {
    progress.spacedRepetition[a.concept] = updateSM2(progress.spacedRepetition[a.concept], a.correct);
  }

  const { weakAreas, strongAreas, overallScore } = computeWeakStrong(progress.quizzes);
  progress.weakAreas = weakAreas;
  progress.strongAreas = strongAreas;
  progress.overallScore = overallScore;

  saveProgress(slug, progress);
  const indexUpdated = touchIndex(slug, progress);

  return ok({
    saved: true, slug, date,
    quiz: { score, total: answers.length },
    overallScore, weakAreas, strongAreas,
    spacedRepetition: Object.fromEntries(answers.map(a => [a.concept, progress.spacedRepetition[a.concept]])),
    indexUpdated,
  });
});

// Single-concept SM-2 advance, for conversational drilling.
const update_spaced_repetition = safe('update_spaced_repetition', async ({ slug, concept, correct }) => {
  requireSlug(slug);
  if (typeof concept !== 'string' || concept.trim() === '') {
    return err('concept is required and must be a non-empty string');
  }
  if (typeof correct !== 'boolean') {
    return err('correct is required and must be a boolean');
  }

  const progress = loadProgress(slug);
  if (!progress.spacedRepetition) progress.spacedRepetition = {};
  const updated = updateSM2(progress.spacedRepetition[concept], correct);
  progress.spacedRepetition[concept] = updated;

  saveProgress(slug, progress);

  return ok({ saved: true, slug, concept, correct, spacedRepetition: updated });
});

module.exports = {
  handlers: {
    list_topics, get_plan, get_progress, get_module_scores,
    get_due_reviews, get_recommendations,
    record_quiz_result, update_spaced_repetition,
  },
  // Exported for tests.
  ok, err, safe, requireSlug, assertValidProgress, saveProgress, dueConcepts,
};
