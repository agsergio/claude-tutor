// Shared data-access layer for ~/.claude/learning/.
// Used by both the dashboard server (skills/dashboard/server/api.js) and the
// MCP server (mcp/server.js). Paths are always absolute — stdio MCP servers
// spawn in an arbitrary cwd, so nothing here may be relative.

const fs = require('fs');
const path = require('path');

// CLAUDE_TUTOR_LEARNING_DIR is an override for tests only. Real users always
// get ~/.claude/learning.
const LEARNING_DIR =
  process.env.CLAUDE_TUTOR_LEARNING_DIR ||
  path.join(process.env.HOME, '.claude', 'learning');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function getIndex() {
  return readJson(path.join(LEARNING_DIR, 'index.json')) || { topics: {} };
}

function findPlanFile(slug) {
  const index = getIndex();
  const topic = index.topics[slug];
  if (topic && topic.planFile) {
    const abs = path.join(LEARNING_DIR, topic.planFile);
    if (fs.existsSync(abs)) return abs;
  }
  // Fallback: glob for slug-*.json
  const plansDir = path.join(LEARNING_DIR, 'plans');
  if (!fs.existsSync(plansDir)) return null;
  const files = fs.readdirSync(plansDir)
    .filter(f => f.startsWith(slug + '-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(plansDir, files[0]) : null;
}

// LOCAL date, YYYY-MM-DD. updateSM2() writes nextReview with the same
// toLocaleDateString('sv-SE') form, so due-date comparisons must use this and
// never toISOString() (which is UTC and can be off by a day).
function today() {
  return new Date().toLocaleDateString('sv-SE');
}

function progressPath(slug) {
  return path.join(LEARNING_DIR, 'progress', `${slug}.json`);
}

function indexPath() {
  return path.join(LEARNING_DIR, 'index.json');
}

module.exports = {
  LEARNING_DIR, readJson, writeJson, getIndex, findPlanFile,
  today, progressPath, indexPath,
};
