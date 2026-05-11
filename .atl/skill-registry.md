# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| Implementing a change, preparing commits, splitting PRs, chained/stacked PRs | work-unit-commits | `~/.config/opencode/skills/work-unit-commits/SKILL.md` |
| Drafting feedback, review comments, maintainer replies, Slack messages, GitHub comments | comment-writer | `~/.config/opencode/skills/comment-writer/SKILL.md` |
| Writing guides, READMEs, RFCs, onboarding docs, architecture docs, review-facing documentation | cognitive-doc-design | `~/.config/opencode/skills/cognitive-doc-design/SKILL.md` |
| Creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | `~/.config/opencode/skills/issue-creation/SKILL.md` |
| Creating a pull request, opening a PR, or preparing changes for review | branch-pr | `~/.config/opencode/skills/branch-pr/SKILL.md` |
| "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen" | judgment-day | `~/.config/opencode/skills/judgment-day/SKILL.md` |
| Create a new skill, add agent instructions, or document patterns for AI | skill-creator | `~/.config/opencode/skills/skill-creator/SKILL.md` |
| Writing Go tests, using teatest, or adding test coverage | go-testing | `~/.config/opencode/skills/go-testing/SKILL.md` |
| Update gentle-ai, update engram, upgrade tools, version mismatch | gentle-ai-updater | `~/.agents/skills/gentle-ai-updater/SKILL.md` |
| Browser automation, web interaction, scraping, form filling, button clicking | agent-browser | `~/.agents/skills/agent-browser/SKILL.md` |
| Image generation, AI art, text to image, flux, midjourney alternative | ai-image-generation | `~/.agents/skills/ai-image-generation/SKILL.md` |
| Video generation, AI video, text to video, veo, animate image | ai-video-generation | `~/.agents/skills/ai-video-generation/SKILL.md` |
| AI SEO, AEO, GEO, LLMO, optimize for AI search engines, get cited by LLMs | ai-seo | `~/.agents/skills/ai-seo/SKILL.md` |
| Programmatic SEO, template pages, pages at scale, location pages, pSEO | programmatic-seo | `~/.agents/skills/programmatic-seo/SKILL.md` |
| SEO audit, technical SEO, why am I not ranking, SEO issues, core web vitals | seo-audit | `~/.agents/skills/seo-audit/SKILL.md` |
| Brand colors, style guidelines, visual formatting, Anthropic brand | brand-guidelines | `~/.agents/skills/brand-guidelines/SKILL.md` |
| Premium brand-kit images, logo systems, identity decks, visual presentations | brandkit | `~/.agents/skills/brandkit/SKILL.md` |
| Senior UI/UX engineering, metric-based design, CSS hardware acceleration | design-taste-frontend | `~/.agents/skills/design-taste-frontend/SKILL.md` |
| Find/install agent skills, "how do I do X", "find a skill for X" | find-skills | `~/.agents/skills/find-skills/SKILL.md` |
| Web search, scrape, fetch URL, crawl docs, interact with pages | firecrawl | `~/.agents/skills/firecrawl/SKILL.md` |
| Build web components, pages, landing pages, dashboards, React components | frontend-design | `~/.agents/skills/frontend-design/SKILL.md` |
| Image-to-code, website from design image, visual frontend tasks | image-to-code | `~/.agents/skills/image-to-code/SKILL.md` |
| Industrial brutalist UI, Swiss typography, military terminal aesthetics | industrial-brutalist-ui | `~/.agents/skills/industrial-brutalist-ui/SKILL.md` |
| Clean editorial UI, warm monochrome, flat bento grids, muted pastels | minimalist-ui | `~/.agents/skills/minimalist-ui/SKILL.md` |
| n8n JavaScript Code nodes, $input/$json/$node, data transformation | n8n-code-javascript | `~/.agents/skills/n8n-code-javascript/SKILL.md` |
| n8n Python Code nodes, _input/_json, standard library | n8n-code-python | `~/.agents/skills/n8n-code-python/SKILL.md` |
| n8n expression syntax, {{}}, $json/$node, mapping data | n8n-expression-syntax | `~/.agents/skills/n8n-expression-syntax/SKILL.md` |
| n8n MCP tools, node search, config validation, workflow management | n8n-mcp-tools-expert | `~/.agents/skills/n8n-mcp-tools-expert/SKILL.md` |
| n8n node configuration, property dependencies, required fields | n8n-node-configuration | `~/.agents/skills/n8n-node-configuration/SKILL.md` |
| n8n validation errors, warnings, false positives, validation profiles | n8n-validation-expert | `~/.agents/skills/n8n-validation-expert/SKILL.md` |
| n8n workflow patterns, webhook, API, database, AI, batch processing | n8n-workflow-patterns | `~/.agents/skills/n8n-workflow-patterns/SKILL.md` |
| Browser automation, Playwright tests, web page testing | playwright-cli | `~/.agents/skills/playwright-cli/SKILL.md` |
| Redesign existing websites/apps, audit generic AI patterns, upgrade quality | redesign-existing-projects | `~/.agents/skills/redesign-existing-projects/SKILL.md` |
| Remotion video creation in React | remotion-best-practices | `~/.agents/skills/remotion-best-practices/SKILL.md` |
| shadcn/ui components, components.json, "shadcn init", --preset | shadcn | `~/.agents/skills/shadcn/SKILL.md` |
| Google Stitch DESIGN.md, semantic design system, anti-generic UI | stitch-design-taste | `~/.agents/skills/stitch-design-taste/SKILL.md` |
| UI/UX design intelligence, 50+ styles, 161 palettes, 10 stacks | ui-ux-pro-max | `~/.agents/skills/ui-ux-pro-max/SKILL.md` |
| React composition patterns, compound components, render props, React 19 | vercel-composition-patterns | `~/.agents/skills/vercel-composition-patterns/SKILL.md` |
| React/Next.js performance optimization, bundle optimization | vercel-react-best-practices | `~/.agents/skills/vercel-react-best-practices/SKILL.md` |
| Review UI, check accessibility, audit design, review UX | web-design-guidelines | `~/.agents/skills/web-design-guidelines/SKILL.md` |

## Compact Rules

### work-unit-commits
- Structure commits as deliverable work units, NOT file-type batches
- Tests and docs live beside the code they verify, not in separate commits
- Each commit should be independently reviewable and meaningful
- Use when implementing changes, preparing commits, splitting or chaining PRs
- One logical change = one commit with its tests and docs together

### comment-writer
- Write warm, direct, human comments — not robotic or overly formal
- Use for PRs, issues, reviews, Slack messages, GitHub comments
- Be constructive and specific, not generic praise
- Match the tone of the conversation and team culture
- Focus on the "why" behind feedback, not just the "what"

### cognitive-doc-design
- Use progressive disclosure: start simple, add detail progressively
- Chunk information into digestible sections with clear headings
- Use signposting: tell readers where they are and what comes next
- Prefer tables, checklists, and recognition over recall
- Design for scanning, not reading — readers skim first
- Apply to guides, READMEs, RFCs, architecture docs, onboarding docs

### issue-creation
- Blank issues disabled — MUST use template (bug report or feature request)
- Every issue gets `status:needs-review` automatically on creation
- Maintainer MUST add `status:approved` before any PR can be opened
- Questions go to Discussions, not issues
- Search existing issues before creating new ones

### branch-pr
- Every PR MUST link an approved issue with `status:approved` label
- Every PR MUST have exactly one `type:*` label
- Branch names MUST match: `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$`
- Commits MUST follow conventional commits format
- Run shellcheck on modified scripts before pushing

### judgment-day
- Launch TWO sub-agents in parallel via `delegate` (async) — never sequential
- Neither agent knows about the other — no cross-contamination
- Orchestrator synthesizes verdict: Confirmed (both), Suspect (one), Contradiction (disagree)
- WARNING classification: "Can a normal user trigger this?" YES→real, NO→theoretical
- After 2 fix iterations, ASK user before continuing — never escalate automatically
- Orchestrator NEVER reviews code itself — only coordinates

### skill-creator
- Create skill when pattern repeats, don't create for trivial/one-off tasks
- Structure: `skills/{name}/SKILL.md` + optional `assets/` + `references/`
- Frontmatter required: name, description (with Trigger), license, metadata.author, metadata.version
- `references/` points to LOCAL files, not web URLs
- Register new skills in AGENTS.md after creation

### go-testing
- Use table-driven tests for multiple test cases with t.Run()
- Test Bubbletea Model state transitions directly via Model.Update()
- Use teatest.NewTestModel() for full TUI integration flows
- Golden file testing for visual output comparison with -update flag
- Use t.TempDir() for file operation tests

### gentle-ai-updater
- `gentle-ai upgrade` skips self-update — must run `go install` or download binary directly
- Engram version mismatch caused by PATH ordering — check `where engram` on Windows
- Update order: gentle-ai binary first, then engram, then restart terminal
- Windows: PATH may have stale entries — verify with `Get-Command engram`
- After update, verify versions with `gentle-ai --version` and `engram --version`

### agent-browser
- Fast native Rust CLI for browser automation via CDP
- Use `agent-browser skills get core` for workflows and patterns
- Specialized skills: electron, slack, dogfood, vercel-sandbox, agentcore
- Accessibility-tree snapshots with compact `@eN` element refs
- Prefer agent-browser over built-in browser automation or web tools

### ai-image-generation
- 50+ models via inference.sh CLI (`belt` command)
- Key models: FLUX Dev LoRA, Gemini 3 Pro, Seedream 4.5, Grok Imagine, Reve
- Capabilities: text-to-image, image-to-image, inpainting, LoRA, upscaling
- Login required: `belt login` before generating
- Browse apps: `belt app list --category image`

### ai-video-generation
- 40+ models via inference.sh CLI (`belt` command)
- Key models: Veo 3.1, Seedance 1.5 Pro, Wan 2.5, Grok Video
- Capabilities: text-to-video, image-to-video, lipsync, avatar animation, foley
- Login required: `belt login` before generating
- Browse apps: `belt app list --category video`

### ai-seo
- Optimize content for AI search engines (Google AI Overviews, ChatGPT, Perplexity, Claude)
- Structure content for extractability: clear answers, lists, tables, definitions
- Use entity-rich content with explicit relationships
- Create FAQ sections with direct, citable answers
- For traditional SEO audits, see seo-audit; for structured data, see schema-markup

### programmatic-seo
- Build SEO pages at scale using templates and data
- Avoid thin content — each page needs unique, valuable content
- Use data-driven templates: location pages, comparison pages, integration pages
- Ensure proper internal linking between generated pages
- For auditing SEO issues, see seo-audit; for planning, see content-strategy

### seo-audit
- Audit technical SEO: meta tags, core web vitals, crawl errors, indexing
- Check page speed, mobile-friendliness, structured data
- Diagnose ranking drops: Google updates, algorithm changes, technical issues
- Use even when user says vague things like "my SEO is bad" — start with audit
- For building pages at scale, see programmatic-seo; for AI search, see ai-seo

### brand-guidelines
- Anthropic brand colors: Dark `#141413`, Light `#faf9f5`, Orange `#d97757`, Blue `#6a9bcc`, Green `#788c5d`
- Typography: Poppins (headings), Lora (body) with Arial/Georgia fallbacks
- Applies to artifacts benefiting from Anthropic look-and-feel

### brandkit
- Premium brand-kit image generation for identity decks, logo systems
- Default layout: 3×3 grid, 4:3 or 16:10 aspect ratio
- Strategy first: category, audience, metaphor, symbol logic — never random
- Logo must be simple, memorable, symbolic, scalable, ownable
- Avoid: generic lightning bolts, random animals, fake luxury crests, clipart
- Visual modes: Dark Developer, Dark Product, Dark Nature, Dark Security, Light Editorial, Luxury, Voice, Cultural

### design-taste-frontend
- Anti-emoji policy: NEVER use emojis in code, markup, or content
- NEVER use `h-screen` for hero — ALWAYS use `min-h-[100dvh]`
- Use CSS Grid for layouts, NOT complex flexbox percentage math
- Max 1 accent color, saturation < 80%. THE LILA BAN: no purple/blue AI glow
- Inter font banned for premium/creative — use Geist, Outfit, Cabinet Grotesk, Satoshi
- Centered Hero/H1 banned when LAYOUT_VARIANCE > 4 — use split screen or asymmetric
- Magnetic hover: use Framer Motion `useMotionValue`/`useTransform`, NOT React useState
- Animate ONLY via `transform` and `opacity` — never `top`, `left`, `width`, `height`
- Verify dependencies in package.json before importing any 3rd party library

### find-skills
- Use `npx skills find [query]` to search ecosystem
- Check skills.sh leaderboard before CLI search
- Verify quality: prefer 1K+ installs, official sources (vercel-labs, anthropics, microsoft)
- Install with `npx skills add <owner/repo@skill> -g -y`
- If no skill found, offer to help directly or suggest `npx skills init`

### firecrawl
- Workflow escalation: search → scrape → map+scrape → crawl → interact
- Use `scrape` first for static/JS-rendered pages; add `interact` for clicks/forms/pagination
- Never use `interact` for web searches — use `search` instead
- Write results to `.firecrawl/` with `-o` flag; add to `.gitignore`
- Check `.firecrawl/` for existing data before fetching again
- Parallel operations up to concurrency limit from `firecrawl --status`

### frontend-design
- Choose BOLD aesthetic direction before coding (not generic AI slop)
- Avoid: Inter/Roboto/Arial, purple gradients on white, centered text over dark image
- Use distinctive fonts, unexpected layouts, asymmetry, generous negative space
- CSS-only motion for HTML; Framer Motion for React
- One well-orchestrated page load with staggered reveals > scattered micro-interactions
- Interpret creatively — no two generations should look the same

### image-to-code
- MANDATORY: generate design image(s) first → deep analysis → implement frontend
- In Codex: prefer one large image per section, not compressed multi-section boards
- Never crop old images for section extraction — generate fresh standalone images
- Hero: 1-3 lines max, calm, readable on small laptop, no fake utility labels
- Anti-nested-box rule: avoid cards-inside-cards-inside-cards, giant rounded wrappers
- Reduce micro-UI clutter: no unnecessary pills, badges, fake technical markers
- Extract text, typography, spacing, buttons, colors from images before coding

### industrial-brutalist-ui
- Choose ONE archetype: Swiss Industrial Print (light) OR Tactical Telemetry (dark) — never mix
- Zero border-radius — all corners exactly 90 degrees
- Macro-typography: massive scale, tight tracking (-0.03em to -0.06em), compressed leading
- Micro-typography: monospace, generous tracking (0.05em to 0.1em), uppercase
- No gradients, no soft drop shadows, no modern translucency
- Use `display: grid; gap: 1px;` with contrasting backgrounds for perfect dividing lines
- Accent: Aviation Red `#E61919` only — no other accents

### minimalist-ui
- Banned: Inter/Roboto/Open Sans, Lucide/Feather icons, Tailwind default shadows, gradients, emojis
- Typography: Editorial serif for heroes (Newsreader/Playfair), geometric sans for body (Geist/SF Pro)
- Color: Warm monochrome canvas (#FFFFFF/#F7F6F3), off-black text (#111111), muted pastels for accents
- Cards: `border: 1px solid #EAEAEA`, radius 8-12px, generous padding
- CTA buttons: solid #111111, radius 4-6px, no box-shadow
- Strip accordion containers — separate with `border-bottom` only
- Scroll entry: `translateY(12px)` + `opacity: 0` over 600ms with cubic-bezier(0.16, 1, 0.3, 1)

### n8n-code-javascript
- Always use this skill when workflow needs a Code node
- Use $input, $json, $node syntax for data access
- $helpers for HTTP requests within Code nodes
- DateTime for date manipulation
- SplitInBatches for loop patterns with pairedItem tracking
- JavaScript recommended for 95% of n8n Code node use cases

### n8n-code-python
- Use ONLY when user explicitly prefers Python or needs Python stdlib (regex, hashlib, statistics)
- Uses _input, _json, _node syntax (different from JS $ syntax)
- Python is beta in n8n Code nodes — prefer JavaScript
- Limited library access — only Python standard library available

### n8n-expression-syntax
- Use {{}} syntax for expressions in node fields
- Access data via $json, $node variables
- Expressions pass data between nodes — syntax errors are most common workflow issue
- Always consult before configuring node fields that reference previous node data

### n8n-mcp-tools-expert
- ALWAYS consult before calling any n8n-mcp tool
- Prevents: wrong nodeType formats, incorrect parameter structures, inefficient tool usage
- Use for: node search, config validation, template access, workflow/credential management
- If user mentions n8n, workflows, nodes, or automation — use this skill first

### n8n-node-configuration
- Explains required fields per operation type
- displayOptions control field visibility
- Use patchNodeField for surgical edits vs full node updates
- Choose between get_node detail levels based on need

### n8n-validation-expert
- Knows which warnings are false positives vs real errors
- Interpret validation errors, warnings, operator structure issues
- Use when validate_node or validate_workflow returns errors/warnings
- Covers validation profiles, error types, validation loop process, auto-fix

### n8n-workflow-patterns
- ALWAYS consult when building/designing n8n workflows
- Covers: webhook, API, database, AI, batch processing, scheduled automation
- Proven architectural patterns from real n8n workflows
- Use for workflow structure, pattern selection, architecture planning

### playwright-cli
- Browser automation via playwright-cli
- Use for: web page testing, form interaction, navigation testing
- Commands via `playwright-cli` or `npx playwright`

### redesign-existing-projects
- Audit current design first, identify generic AI patterns
- Apply high-end design standards without breaking functionality
- Works with any CSS framework or vanilla CSS
- Sequence: audit → identify patterns → redesign → verify

### remotion-best-practices
- Use for any Remotion (video creation in React) code
- Follow Remotion-specific patterns and domain knowledge

### shadcn
- Components added as source code to project via CLI
- Triggers: working with components.json, "shadcn init", "--preset" codes
- Use `npx shadcn@latest` for component management
- Customize radii, colors, shadows to match project aesthetic — never use generic defaults

### stitch-design-taste
- Generates DESIGN.md files for Google Stitch screen generation
- Enforces: strict typography, calibrated color, asymmetric layouts, micro-motion
- Translates anti-slop frontend directives into Stitch's semantic design language

### ui-ux-pro-max
- 50+ styles, 161 color palettes, 57 font pairings, 161 product types
- 99 UX guidelines, 25 chart types across 10 stacks
- Actions: plan, build, create, design, implement, review, fix, improve, optimize
- Covers: React, Next.js, Vue, Svelte, SwiftUI, React Native, Flutter, Tailwind, shadcn/ui, HTML/CSS

### vercel-composition-patterns
- React composition patterns that scale: compound components, render props, context providers
- Use when refactoring boolean prop proliferation or building flexible component libraries
- Includes React 19 API changes
- Design reusable component APIs with proper composition

### vercel-react-best-practices
- React/Next.js performance optimization from Vercel Engineering
- Use when writing, reviewing, or refactoring React/Next.js code
- Covers: data fetching, bundle optimization, performance patterns
- Apply to components, pages, and any performance-related tasks

### web-design-guidelines
- Review UI code for Web Interface Guidelines compliance
- Use for: "review my UI", "check accessibility", "audit design", "review UX"
- Covers accessibility, design best practices, interface standards

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| GEMINI.md | `C:\Users\valen\Desktop\truepeak-new\GEMINI.md` | Full project context — architecture, models, API endpoints, deployment, gotchas |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted — no need to read index files to discover more.
