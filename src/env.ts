import 'dotenv/config';

/**
 * List every environment variable this app needs to run.
 * Each variable must also appear in `.env.example` with a placeholder value
 * and a one-line comment on where to get it.
 */
export const REQUIRED_ENV_VARS: readonly string[] = [
  // 'MY_SERVICE_API_KEY',
];

/**
 * Checks that every required environment variable is set.
 * If one is missing, the app stops with a plain-English message that names
 * the variable and points to `.env` / the README — so non-technical users
 * know exactly what to do.
 */
export function validateEnv(required: readonly string[] = REQUIRED_ENV_VARS): void {
  const missing = required.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === '';
  });

  if (missing.length > 0) {
    const lines = [
      '',
      '❌ The app cannot start: some secrets are missing.',
      '',
      ...missing.map((name) => `   • ${name} is not set.`),
      '',
      'How to fix it:',
      '  1. Open the file named .env in this project folder.',
      '     (No .env file yet? Copy .env.example and rename the copy to .env)',
      '  2. Add the missing value(s) listed above.',
      '  3. Ask the system owner (usually Marco) for the real values — see the',
      '     "Where secrets come from" section in README.md.',
      '',
    ];
    console.error(lines.join('\n'));
    process.exit(1);
  }
}

/**
 * Returns the value of a required environment variable.
 * Call validateEnv() at startup first, then use this anywhere in the app.
 */
export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing environment variable ${name}. Add it to your .env file (see README.md).`,
    );
  }
  return value;
}
