#!/usr/bin/env node
// claude-tutor MCP server (stdio).
//
// Exposes the learner's data in ~/.claude/learning/ so Claude can read plans
// and progress and record quiz results conversationally.
//
// IMPORTANT: stdout carries JSON-RPC. Never console.log here — use
// console.error for every diagnostic. See handlers.js for the write-safety
// rules (the enforce-paths.js hook does not cover MCP tool calls).

let McpServer, serveStdio, z;
try {
  ({ McpServer } = require('@modelcontextprotocol/server'));
  ({ serveStdio } = require('@modelcontextprotocol/server/stdio'));
  z = require('zod');
} catch (e) {
  console.error(`
[claude-tutor] MCP dependencies are not installed.

Installing the plugin from GitHub does not run npm install, so mcp/node_modules
does not exist yet. Install them once:

    cd "${__dirname}" && npm install

Then restart Claude Code (/reload-plugins) or the Claude desktop app.

Original error: ${e.message}
`);
  process.exit(1);
}

const { handlers } = require('./handlers');
const { LEARNING_DIR } = require('../lib/store');

const slug = z.string().describe('Topic slug, e.g. "kubernetes-networking". Use list_topics to discover valid slugs.');

// registerTool(name, config, cb) — inputSchema is a Standard Schema; a zod
// object is what the SDK's own examples use.
const TOOLS = [
  ['list_topics', {
    title: 'List learning topics',
    description: 'List every topic the learner has a plan for, with quiz count, overall score (0-100) and last activity.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }],
  ['get_plan', {
    title: 'Get learning plan',
    description: 'Get the full learning plan for a topic: modules, objectives, key concepts, resources and time estimates.',
    inputSchema: z.object({ slug }),
    annotations: { readOnlyHint: true },
  }],
  ['get_progress', {
    title: 'Get quiz progress',
    description: 'Get quiz history, weak/strong areas, overall score (0-100) and spaced-repetition state for a topic.',
    inputSchema: z.object({ slug }),
    annotations: { readOnlyHint: true },
  }],
  ['get_module_scores', {
    title: 'Get per-module scores',
    description: 'Per-module quiz scores for a topic. A null score means the module has not been quizzed yet.',
    inputSchema: z.object({ slug }),
    annotations: { readOnlyHint: true },
  }],
  ['get_due_reviews', {
    title: 'Get due reviews',
    description: 'List concepts whose spaced-repetition review date has arrived, across all topics.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }],
  ['get_recommendations', {
    title: 'Get study recommendations',
    description: 'What to study next, ranked: due reviews first, then weak areas, then unstarted modules.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }],
  ['record_quiz_result', {
    title: 'Record quiz result',
    description: 'Record a completed quiz: appends the quiz, advances SM-2 spaced repetition per concept, recomputes weak/strong areas and the overall score, and updates the topic index.',
    inputSchema: z.object({
      slug,
      answers: z.array(z.object({
        concept: z.string().describe('The key concept the question tested.'),
        correct: z.boolean().describe('Whether the learner answered correctly.'),
        format: z.string().optional().describe('Question format, e.g. "mcq", "short-answer". Defaults to "mcq".'),
      })).min(1).describe('One entry per question asked.'),
      module: z.union([z.string(), z.number()]).optional().describe('Module id the quiz covered, if any.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }],
  ['update_spaced_repetition', {
    title: 'Update spaced repetition',
    description: 'Advance the SM-2 schedule for a single concept after drilling it in conversation. Does not append a quiz entry.',
    inputSchema: z.object({
      slug,
      concept: z.string().describe('The concept that was drilled.'),
      correct: z.boolean().describe('Whether the learner got it right.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }],
];

function createServer() {
  const server = new McpServer(
    { name: 'claude-tutor', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  for (const [name, config] of TOOLS) {
    server.registerTool(name, config, (args) => handlers[name](args));
  }
  return server;
}

if (require.main === module) {
  console.error(`[claude-tutor] MCP server starting; data dir: ${LEARNING_DIR}`);
  serveStdio(createServer, {
    onerror: (error) => console.error(`[claude-tutor] transport error: ${error.message}`),
  });
}

module.exports = { createServer, TOOLS };
