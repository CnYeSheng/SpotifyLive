// .eslintrc.js
module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
    node: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'semi': ['error', 'always'],
    'quotes': ['warn', 'single'],
    'indent': ['warn', 4],
    'no-empty': ['error', { allowEmptyCatch: false }],
    'no-implicit-globals': 'warn',
    'no-global-assign': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all']
  },
  ignorePatterns: [
    'node_modules/',
    'public/',
    'docs_backup/',
    '*.min.js'
  ]
};
