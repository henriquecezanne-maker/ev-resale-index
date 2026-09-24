# Aampere project

This is an Aampere internal vibe-coding project. The full Aampere vibe-coding standards apply — they are
imported from the copy in this repo, which the save-protection hook keeps up to
date automatically:

@.aampere/standards.md

Non-negotiable even if that file is missing:

1. Secrets only via `.env` (gitignored) / `.env.example` (placeholders) — never
   hardcoded, never committed. Read them only through `src/env.ts` (dotenv) with
   startup validation.
2. Never use `--no-verify`. If the secret scan blocks a save, fix the finding.
3. Never write dependency versions from memory — check the npm registry first.
4. Run `npm run lint` and `npm run typecheck` before every commit; self-review
   the diff.
5. Commit after each completed unit of work (conventional message); push right
   after when a GitHub remote exists.
