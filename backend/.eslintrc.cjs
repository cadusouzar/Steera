module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // runAsSystem (prisma/tenant-context.ts) is the RLS backstop's narrow
    // cross-tenant bypass escape hatch — legitimate only for AuthService's
    // pre-authentication lookups and this project's own e2e-test
    // setup/teardown code. Restricted here structurally (not just by
    // comment) to backend/src/auth/** and backend/test/** via the override
    // below — importing it from any other module is a lint error.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/prisma/tenant-context', '**/tenant-context'],
            importNames: ['runAsSystem'],
            message:
              'runAsSystem is a narrow RLS bypass escape hatch — only backend/src/auth/** and backend/test/** may import it. See tenant-context.ts for why.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['src/auth/**/*.ts', 'test/**/*.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
    {
      // tenant-rls.extension.spec.ts legitimately exercises the bypass code
      // path of the RLS extension itself (login/register/refresh pre-auth,
      // e2e setup/teardown) — the same narrow, audited use already allowed
      // for src/auth/**/test/** above, just exercised from the extension's
      // own unit test instead.
      files: ['src/prisma/tenant-rls.extension.spec.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
