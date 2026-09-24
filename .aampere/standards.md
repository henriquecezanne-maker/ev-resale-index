# Aampere vibe-coding standards

These rules are mandatory in every Aampere vibe-coding project (apps built with Claude Code) — they are not Aampere's general coding standards. They exist so that ~30 mostly
non-technical colleagues can build apps that stay safe and maintainable. Never
deviate silently.

## Tech stack (fixed default)

TypeScript (strict) + Node.js LTS + npm. SQLite via `better-sqlite3` for local data.
Vitest for tests. ESLint with typescript-eslint **strict type-checked** config plus
`tsc --noEmit`. No Biome, no Semgrep, no other stacks.

Deviate ONLY when the project genuinely needs it (e.g. Python for an ML library).
In that case: explain the need to the user in plain language, get their explicit
confirmation, record the decision in `.aampere.json` and check "Other: ___" in
`docs/architecture.md` with a short reason.

## Secrets — the only allowed pattern

- Real values live ONLY in `.env` (gitignored, stays on the user's computer).
- `.env.example` is committed and lists every required variable with a placeholder
  value and a one-line comment on where to get it.
- NEVER hardcode credentials, tokens, API keys, webhook URLs with embedded tokens,
  or passwords in code, docs, or commits — not even "temporarily".
- Code reads secrets exclusively from environment variables via `dotenv`
  (use the project's `src/env.ts` helper).
- Every app validates required variables at startup and exits with a plain-English
  message naming the missing variable and pointing to `.env` / the README.
- Users get real values from the system owner (usually Marco) via the password
  manager — never via code, chat pasted into files, or commits.
- The README has a "Where secrets come from" section — keep it current.

## Dependencies — never trust memory

- NEVER write a package version number from memory.
- Before adding any dependency: check the current version with
  `npm view <pkg> version`, then install with `npm install <pkg>@latest`
  (or the newest version compatible with the project).
- After scaffolding or any bulk edit of `package.json`, verify every version in it
  against the npm registry.

## Commit & push cadence

- Commit after EACH completed unit of work with a clear conventional message
  (`feat: …`, `fix: …`, `docs: …`, `chore: …`).
- Push immediately after every commit if the project has a GitHub remote.
- Never use `--no-verify`. If the pre-commit secret scan blocks a commit, fix the
  finding (move the value to `.env`); never bypass it.

## Quality gates before every commit

- Run `npm run lint` and `npm run typecheck`; fix all findings first.
- Self-review the full diff before committing — look for leftover debug code,
  accidental secrets, and unrelated changes.
- Every loop must have a guaranteed exit condition or an explicit max-iteration
  guard. No `while (true)` without a hard break bound.

## Docs workflow

- Keep `README.md` current (what the app does, how to run it, secrets section).
- Update `docs/architecture.md` (Mermaid diagram + tech-stack checklist) whenever
  the structure or dependencies change.
- Before implementing, open the current task source — the roadmap status checklist
  in `docs/roadmap.md`, or the active task-group file in `docs/tasks/` — and check
  items off as they are completed.
- After completing a task group: commit and push.

## Language

All user-facing text (messages to the user, docs, error messages) is simple
English with zero git/dev jargon: say "save to GitHub", not "push to remote origin".
