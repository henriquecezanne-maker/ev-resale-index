// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // src/client/** ships to the browser, not through the Node TS project
    // (no DOM lib, no Node types) — it's a static asset inlined at build time.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.js', 'src/client/**'],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Loop-safety rules — required by Aampere standards, do not disable.
      'no-constant-condition': 'error',
      'no-unmodified-loop-condition': 'error',
    },
  },
);
