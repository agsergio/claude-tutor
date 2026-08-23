---
name: learn
description: Use when user wants to learn a topic or create a study plan. Triggers on "teach me", "I want to learn", "explain X to me", "study", "help me understand", "where do I start with", "how do I get into", or any request to understand a subject in depth. Covers both technical topics (programming, system design, DevOps) and general knowledge (history, science, languages, music theory). Also use when someone asks for a "learning path", "roadmap", or "curriculum" for a topic — even if they don't explicitly say "learn".
---

# Learn — Topic Research & Learning Plan Generator

## Overview

Guide the user from a vague "I want to learn X" into a structured, researched learning plan with curated resources. Ask clarifying questions, research the topic, and produce a module-by-module plan saved to disk.

## File Storage Rules — EXACT PATHS (no deviation)

The learning system uses three separate directories. Each directory has ONE purpose:

| Directory | Stores | Allowed fields |
|---|---|---|
| `~/.claude/learning/plans/` | Learning plans ONLY | topic, slug, created, level, goal, depth, timeCommitment, modules, totalEstimatedTime, diagnostic |
| `~/.claude/learning/progress/` | Quiz progress ONLY | topic, quizzes, weakAreas, strongAreas, overallScore, spacedRepetition |
| `~/.claude/learning/` (root) | index.json + profile.json ONLY | topics (index), learningStyle/background/createdTopics (profile) |

CORRECT — saving a learning plan:    `~/.claude/learning/plans/dns-2026-03-29.json`
WRONG — saving a learning plan:      `~/.claude/learning/progress/dns.json`

CORRECT — saving quiz progress:      `~/.claude/learning/progress/dns.json`
WRONG — saving quiz progress:        `~/.claude/learning/plans/dns-2026-03-29.json`

CORRECT — saving any learning data: `~/.claude/learning/plans/dns-2026-03-29.json`
WRONG — saving to project directory: `./learning/plans/dns-2026-03-29.json`

Always use the ABSOLUTE path `~/.claude/learning/` — never a relative path like `./learning/`.
Never add quiz fields (quizzes, weakAreas, strongAreas, spacedRepetition, overallScore) to plan files.
Never add plan fields (modules, resources, goal, depth, timeCommitment) to progress files.
Verify the path is correct BEFORE writing.

## Process

### Check for Existing Topic

Before starting a new plan, check if this topic already exists.

Read `~/.claude/learning/index.json` and look for a matching topic (fuzzy match same as quiz skill: "k8s" → "kubernetes").

**If the topic exists:**
1. Read the plan file and progress file
2. Show a brief status:

```
── Resuming: [Topic] ────────────────────
Level: [level] | Modules: [completed]/[total] | Score: [score]%
Last activity: [date]
──────────────────────────────────────────
```

3. Determine the next action:
   - If no quizzes taken on any module: "Ready to start learning? I'll teach you Module 1: [title]"
   - If some modules quizzed: "You left off at Module [N]: [title]. Continue?"
   - If all modules quizzed with score >80%: "You've completed this topic! Want to retake quizzes on weak areas, or adjust the plan?"
4. If user wants to continue, teach the next incomplete module interactively (see Phase 5: Teach)
5. If user wants to adjust, load the existing plan and let them modify it

**If the topic is new:** proceed to Phase 0 (profile) and Phase 1 (scope).

### Phase 0: Load or Create Learner Profile

Read `~/.claude/learning/profile.json` if it exists.

**If profile exists:**
- Greet the user by acknowledging their learning style and background
- Skip questions about learning style and background in Phase 1 — you already know
- Still ask topic-specific questions (level, goal, focus areas)

**If no profile exists (first time):**
- During Phase 1, include the learning style question (see Phase 1 examples)
- After Phase 1, save the profile as JSON to `~/.claude/learning/profile.json` (create directory if needed):
  - `learningStyle`: the user's choice (e.g., "hands-on")
  - `background`: extracted from level + goal answers
  - `createdTopics`: array with the current topic slug

**If profile exists and this is a new topic:**
- Append the topic slug to `createdTopics` array

### Phase 1: Clarify Scope

**ALWAYS** use the `AskUserQuestion` tool when asking the user questions, in any context. If you have too many questions for the tool, split them up into multiple calls.

Ask 2-5 clarifying questions, skipping any already answered by the user's initial message.

**Rules:**
- Ask ONE question per message — wait for the answer before asking the next
- Use multiple choice with clear options and descriptions for every question
- Only one question per message — never combine questions
- Ask at least 2 (level + goal) — cap at 5
- If a learner profile exists, skip the learning style question

**Question 1 — Current level:**

Ask "What's your current experience with [topic]?" with options:
- No experience — Complete beginner, starting from scratch
- Some basics — Familiar with core ideas but not hands-on
- Intermediate — Working knowledge, want to go deeper
- Advanced — Strong foundation, want expert-level depth

**Question 2 — Learning goal:**

Ask "What do you want to be able to do after learning [topic]?" with 3 topic-specific goal options. Each option needs a label and a description.

**Question 3 — Depth** (optional):

Ask "How deep do you want to go?" with options:
- High-level overview — Understand the big picture and key concepts
- Working knowledge — Enough to use it confidently day-to-day
- Deep expertise — Thorough understanding including edge cases

**Question 4 — Focus areas** (optional):

Ask which areas to focus on. Allow selecting multiple from 2-4 topic-specific subtopics, each with a label and description.

**Question 5 — Time commitment** (optional):

Ask "How much time do you want to invest?" with options:
- A few hours — Quick introduction to the basics
- A weekend — Solid foundation with practice
- A week — In-depth study with projects
- Ongoing study — Long-term learning commitment

**If no learner profile exists**, also ask "How do you prefer to learn?" with options:
- Reading docs & articles — Text-based, self-paced learning
- Watching videos — Visual explanations and walkthroughs
- Hands-on projects — Learn by building and experimenting
- Theory first — Understand principles, then apply them

### Phase 1.5: Diagnostic Assessment (non-beginners only)

Skip this phase if the user said they have "no experience" or are a "complete beginner."

For users with some background, generate a 5-question diagnostic quiz to calibrate their actual level. This prevents wasting time on material they already know.

**How to run the diagnostic:**

Generate 5 multiple choice questions testing foundational concepts at increasing difficulty. Ask ONE question per message — wait for the answer before the next.

- Questions 1-2: Basic terminology and concepts (should be easy for anyone with "some basics")
- Questions 3-4: Intermediate understanding (application of concepts)
- Question 5: Advanced concept (only experts get this right)

Each question should have 4 options with descriptions. Label them "Diagnostic Q1/5" through "Q5/5".

After the diagnostic, note which level the user actually tested at:
- 0-1 correct: Suggest starting from beginner despite their self-assessment
- 2-3 correct: Confirmed intermediate — can skip introductory modules
- 4-5 correct: Confirmed advanced — compress fundamentals, focus on depth

Store the diagnostic results in the plan JSON by adding a `diagnostic` field:

```json
{
  "diagnostic": {
    "taken": true,
    "score": 3,
    "total": 5,
    "calibratedLevel": "intermediate",
    "skipModules": []
  }
}
```

Use these results in Phase 3 (Generate Learning Plan) to mark introductory modules as "skippable" or compress them into a quick review.

### Phase 2: Research

Perform **3-5 web searches** with varied queries:

1. `"[topic] learning roadmap [year]"` — find structured learning paths
2. `"best [topic] tutorial for [level]"` — find recommended resources
3. `"[topic] official documentation"` — find authoritative sources
4. `"[topic] [specific subtopic] guide"` — drill into focus areas
5. `"[topic] common mistakes beginners"` — anticipate pitfalls

If the topic is practical (anything you can actually build, configure, or run), add **1-3 lab-oriented searches**:

6. `"[topic] hands-on lab"` / `"[topic] tutorial walkthrough"`
7. `"containerlab [topic] topology"` — or the domain's equivalent sandbox
8. `"[topic] free sandbox environment"`

**Platform hints** — these are search seeds, NOT an authority to copy from. Use them to shape queries; never paste a platform into the output plan unless a search result actually confirms a lab exists there. A hardcoded catalog goes stale.

- **Networking:** containerlab, GNS3, EVE-NG, Cisco dCloud, Cisco DevNet Sandbox
- **GPU & AI infra:** NVIDIA LaunchPad, NVIDIA DLI, NGC containers
- **Cloud-native:** killercoda, kind, minikube, Play with Kubernetes
- **General dev:** devcontainers, GitHub Codespaces, Google Colab, Docker Compose

For each search:
- Use the WebSearch tool
- Fetch the top 2-3 results with WebFetch
- Extract: key concepts, recommended order, good resources, common learning paths
- For lab searches, also extract: the exact lab URL, what it requires to run, and how you'd know it worked

**Synthesize** the research into a coherent structure. Don't just list links — understand what the community recommends and why.

### Phase 3: Generate Learning Plan

Create a structured plan with modules. Present it to the user in readable markdown:

```
## Learning Plan: [Topic]

**Level:** [beginner/intermediate/advanced]
**Goal:** [user's goal]
**Estimated time:** [total]

### Module 1: [Title]
**Time:** [estimate]
**Objectives:**
- [what the user will understand/be able to do]

**Key concepts:** [list]

**Labs:** (omit this whole section if the module has none)
- [lab title] — [platform], [setup], [time] — verify: [success criterion]

**Resources:**
- [resource with link and type]

### Module 2: [Title]
...
```

**Rules:**
- 3-8 modules depending on topic depth
- Each module should be completable in one sitting
- Order modules from foundational to advanced
- Include a mix of resource types per module (docs, videos, tutorials, books)
- Note free vs paid resources
- Every module MUST have `keyConcepts` with at least 2 concept strings — the quiz system uses these to generate questions. A module with empty keyConcepts is broken.
- If a diagnostic was taken, mark modules covering concepts the user already knows as "Review (optional)" instead of required

**Lab rules:**
- Aim for **at least one lab per module where the topic is practical** — this is NOT forced. Pure-theory modules (exam vocabulary, history, conceptual overviews) legitimately have no labs. Omit the `labs` field entirely rather than padding a theory module with invented exercises — filler is worse than nothing.
- Every lab MUST have a `verify` criterion: a concrete pass/fail success check ("BGP session reaches Established", "container serves 200 on /healthz"). If you can't state how you'd know it worked, it isn't a lab — drop it.
- Prefer `local`/`hosted` over `vendor`/`cloud` when both teach the same thing. A lower barrier means the lab actually gets done.
- `setup` values: `local` (runs on your machine, no account — containerlab, GNS3, Docker, devcontainers, kind), `hosted` (free browser lab, account only — killercoda, DevNet Sandbox, NVIDIA DLI free tier), `vendor` (vendor-gated, may need entitlement or a waitlist — Cisco dCloud, NVIDIA LaunchPad), `cloud` (runs on your own cloud spend).

**URL integrity — hard requirement, not a preference:**
- Every `url` on a lab or resource MUST come from an actual WebSearch or WebFetch result you saw in Phase 2. **Never construct, guess, or pattern-match a URL.** A plausible-looking `dcloud.cisco.com/...` that 404s wastes the user's evening and destroys trust in the entire plan.
- If a lab is a good idea but no verifiable URL was found, emit it with `"url": null` and describe what to build in the `title` and `verify` fields. An honest un-linked exercise beats a fabricated link.
- Same rule for books: chapter numbers shift between editions, so prefer books whose table of contents you can actually verify with WebFetch before writing a `sections` range.

Ask the user: "Does this plan look good? Want to adjust anything — add, remove, or reorder modules?"

### Phase 4: Save

After user approves the plan:

1. **Construct path**: `~/.claude/learning/plans/{topic-slug}-{YYYY-MM-DD}.json`
2. **Verify path** contains `/plans/` — NOT `/progress/`
3. **Create directory** `~/.claude/learning/plans/` if it doesn't exist (use Bash: `mkdir -p`)
4. **Save plan** as JSON to that path — use ONLY the fields listed below:

The JSON format:

```json
{
  "topic": "Topic Name",
  "slug": "topic-name",
  "created": "YYYY-MM-DD",
  "level": "beginner|intermediate|advanced",
  "goal": "user's stated goal",
  "depth": "overview|working-knowledge|deep",
  "timeCommitment": "a few hours|a weekend|a week|ongoing",
  "modules": [
    {
      "id": 1,
      "title": "Module Title",
      "objectives": ["objective 1", "objective 2"],
      "keyConcepts": ["concept1", "concept2"],
      "estimatedTime": "2 hours",
      "resources": [
        {
          "title": "Resource Name",
          "url": "https://...",
          "type": "docs|video|tutorial|book|course|lab",
          "free": true,
          "author": "Tanenbaum",
          "edition": "6th",
          "sections": "Ch. 4-6 (skip 5.3)"
        }
      ],
      "labs": [
        {
          "title": "containerlab: sonic-vs + FRR BGP peering",
          "platform": "containerlab",
          "url": "https://containerlab.dev/lab-examples/...",
          "setup": "local|hosted|vendor|cloud",
          "cost": "free",
          "estimatedTime": "3 hours",
          "prerequisites": ["Docker", "8 GB RAM"],
          "verify": "sonic-vs boots, config_db.json applied, BGP session up to FRR"
        }
      ]
    }
  ],
  "totalEstimatedTime": "15 hours"
}
```

Optional module/resource fields — include them only when they carry real information:
- `labs` — omit the key entirely for modules with no genuine hands-on exercise (see Lab rules above)
- `author`, `edition`, `sections` on a resource — for `type: "book"`, so the user knows *which chapters* to read
- `type: "lab"` on a resource — for a lab *platform* used as reference material, distinct from a specific `labs[]` exercise
- A lab with no verifiable URL uses `"url": null` — never a guessed link

3. **Update index** at `~/.claude/learning/index.json`:
   - **Read the existing file first** — do not overwrite other topics
   - If the file doesn't exist, create `{"topics":{}}`
   - Add/update ONLY this topic's entry (preserve all other topics):

```json
{
  "displayName": "Topic Name",
  "planFile": "plans/topic-name-2026-03-01.json",
  "progressFile": "progress/topic-name.json",
  "created": "2026-03-01",
  "lastActivity": "2026-03-01",
  "level": "beginner",
  "modulesCompleted": 0,
  "modulesTotal": 5,
  "quizzesTaken": 0,
  "overallScore": null
}
```

4. **Update profile** at `~/.claude/learning/profile.json`:
   - Read existing profile (or create `{}` if missing)
   - Set `learningStyle` if determined in Phase 1
   - Set `background` from the level
   - Append the topic slug to `createdTopics` array (if not already present)

5. **Confirm** to the user: "Learning plan saved! You can now use `/quiz [topic]` to test your knowledge, or `/resources [topic]` to see all resources."

### Phase 5: Teach (optional)

After saving the plan (or when resuming an existing topic), offer to teach the next incomplete module.

Ask: "Ready to start Module [N]: [title]? I can walk you through it now, or you can study on your own and come back for a quiz."

**If the user wants to be taught:**

Teach the module interactively. The goal is genuine understanding, not information dumping.

**Teaching structure for each module:**

1. **Connect to prior knowledge** — "In the last module you learned [X]. [Topic] builds on that by..." If this is Module 1 or you don't know the user's background, connect to general knowledge or the user's stated goals.

2. **Explain core concepts** — Cover each key concept from the module's `keyConcepts` list. For each concept:
   - Give a clear, concise explanation (2-3 paragraphs max)
   - Use an analogy that connects to something the user likely knows
   - Provide a concrete example
   - If the learner profile says "hands-on", emphasize examples and exercises
   - If "theory-first", lead with principles before examples

3. **Check understanding** — After every 2-3 concepts, ask a quick multiple choice comprehension question. This isn't a quiz — it's a "does this make sense?" check. If the user gets it wrong, re-explain differently before moving on.

4. **Reference resources** — Point to specific resources from the module: "For a deeper dive on this, check out [Resource Title] — it covers [specific aspect]."

5. **Summarize** — At the end of the module, recap the 3-5 key takeaways.

6. **Bridge to next** — "Next up is Module [N+1]: [title], which builds on [concept] you just learned."

7. **Suggest quiz** — "Want to test what you've learned? Run `/quiz [topic]` (and mention the module you just covered) to check your understanding."

**Teaching guidelines:**
- Keep explanations conversational, not textbook-like
- Never go more than 3-4 paragraphs without an interaction point
- If the user seems to be struggling (wrong answers on comprehension checks), slow down and add more examples
- If the user is breezing through, pick up the pace and add depth
- Use the learner profile's learning style to adapt your approach

**If the user declines teaching:**
- Suggest: "No problem! Study at your own pace using the resources in the plan. When you're ready, run `/quiz [topic]` to test your knowledge."

## Topic Slug Convention

Convert topic to kebab-case for filenames: "Kubernetes Networking" → "kubernetes-networking", "Spanish Grammar" → "spanish-grammar". Use lowercase, replace spaces with hyphens, remove special characters.
