// G2: קונפיג eslint מוכן לקראת ריצת העיצוב המתואמת (one-shot).
// חשוב: ההרצה עצמה רק בחלון מתואם בלי עבודות פתוחות (G2). בחלון: npm i -D eslint globals prettier, הרצת eslint+prettier, קומיט ייעודי.
const globals = require('globals');
module.exports = [
  { ignores: ['node_modules/', 'dist/', 'backups/', 'coverage/'] },
  {
    files: ['src/**/*.js', 'test/**/*.js', 'e2e/**/*.js', 'scripts/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], 'no-undef': 'error' },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker } },
    rules: { 'no-unused-vars': 'warn' },
  },
];
