import { validateEnv } from './env.js';

// Always validate secrets first — if something is missing, the app stops here
// with a friendly message instead of crashing somewhere deep inside.
// (This app currently needs no secrets, but every entry point checks anyway.)
validateEnv();

console.log(
  'EV Resale Index build pipeline — not implemented yet. See docs/roadmap.md for the plan.',
);
