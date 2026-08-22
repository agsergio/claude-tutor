/**
 * Parser for an external "skill signal" markdown feed.
 *
 * The feed is machine-generated and has a fixed layout:
 *
 *   # Skill signal — YYYY-MM-DD
 *   ## Study next
 *   | # | Skill | Market rank | Seen in | Stage | Gap | Next action |
 *   ## Rising in the market
 *   - **Skill** #15 (up 3 from #18) · stage: not-started
 *   ## Already job-ready — do not re-plan
 *   Version Control, Caching / CDN, Unit Testing
 *
 * This module is READ-ONLY: it never writes anything, anywhere.
 *
 * Every field is treated as optional and the parser fails closed — any
 * problem yields null (panel hidden) rather than a crash or a half-built
 * table. Takes the file's text, not a path, so it is trivially testable.
 */

const EM_DASH = '—';

// A placeholder cell ("—" or "-") means "no value".
function cell(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t === EM_DASH || t === '-' || t === '--') return null;
  return t;
}

function num(text) {
  const t = cell(text);
  if (t == null) return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// "#8" -> 8
function rankNum(text) {
  const t = cell(text);
  if (t == null) return null;
  const m = t.match(/#?\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

// "20 postings" -> 20
function freqNum(text) {
  const t = cell(text);
  if (t == null) return null;
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Split "| a | b | c |" into ['a','b','c'].
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(c => c.trim());
}

function isSeparatorRow(line) {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes('-');
}

// Return the lines belonging to a "## <name>" section, up to the next heading.
function sectionLines(lines, headingTest) {
  const start = lines.findIndex(l => /^##\s+/.test(l) && headingTest(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s+/.test(lines[i]) || lines[i].trim() === '---') break;
    out.push(lines[i]);
  }
  return out;
}

function parseDate(lines) {
  for (const line of lines) {
    const m = line.match(/^#\s+Skill signal\s*[-–—]\s*(\d{4}-\d{2}-\d{2})/i);
    if (m) return m[1];
  }
  return null;
}

function parseStudyNext(lines) {
  const rows = sectionLines(lines, l => /study next/i.test(l))
    .filter(l => l.trim().startsWith('|'))
    .filter(l => !isSeparatorRow(l));
  if (rows.length === 0) return [];

  // Drop the header row if present (it names the columns, not a skill).
  const firstCells = splitRow(rows[0]);
  const body = /^skill$/i.test(firstCells[1] || '') ? rows.slice(1) : rows;

  const out = [];
  for (const line of body) {
    const c = splitRow(line);
    if (c.length < 2) continue;
    const skill = cell(c[1]);
    if (!skill) continue; // a row without a skill is unusable
    out.push({
      rank: rankNum(c[2]),
      skill,
      freq: freqNum(c[3]),
      stage: cell(c[4]),
      gap: num(c[5]),
      nextAction: cell(c[6]),
    });
  }
  return out;
}

function parseRising(lines) {
  const out = [];
  for (const line of sectionLines(lines, l => /rising/i.test(l))) {
    const t = line.trim();
    if (!/^[-*]\s+/.test(t)) continue;
    const body = t.replace(/^[-*]\s+/, '');

    const skillMatch = body.match(/\*\*(.+?)\*\*/);
    const skill = skillMatch ? cell(skillMatch[1]) : null;
    if (!skill) continue;

    const rest = body.slice(skillMatch[0].length);
    const rank = rankNum((rest.match(/#\s*\d+/) || [])[0]);
    const move = rest.match(/\((up|down)\s+(\d+)\s+from\s+#?\s*(\d+)\)/i);
    const stageMatch = rest.match(/stage\s*:\s*([^·|]+)/i);

    out.push({
      skill,
      rank,
      direction: move ? move[1].toLowerCase() : null,
      delta: move ? Number(move[2]) : null,
      prevRank: move ? Number(move[3]) : null,
      stage: stageMatch ? cell(stageMatch[1]) : null,
    });
  }
  return out;
}

function parseJobReady(lines) {
  const body = sectionLines(lines, l => /job-?ready/i.test(l));
  const out = [];
  for (const line of body) {
    const t = line.trim();
    if (!t || t.startsWith('|') || t.startsWith('>')) continue;
    for (const part of t.split(',')) {
      const s = cell(part);
      if (s) out.push(s);
    }
    break; // the list is a single line
  }
  return out;
}

/**
 * Parse skill-signal markdown.
 * @param {string} text raw file contents
 * @returns {{date: string|null, studyNext: Array, rising: Array, jobReady: string[]}|null}
 *          null when the input is unusable (caller should hide the panel).
 */
function parseSkillSignal(text) {
  try {
    if (typeof text !== 'string' || text.trim() === '') return null;
    const lines = text.split(/\r?\n/);

    const studyNext = parseStudyNext(lines);
    if (studyNext.length === 0) return null; // nothing worth rendering

    return {
      date: parseDate(lines),
      studyNext,
      rising: parseRising(lines),
      jobReady: parseJobReady(lines),
    };
  } catch (e) {
    return null; // fail closed — a feed format change must never break the dashboard
  }
}

module.exports = { parseSkillSignal };
