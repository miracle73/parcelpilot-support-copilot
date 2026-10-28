#!/usr/bin/env node
// Vercel build step. Writes the public runtime configuration into config.js.
// Only non-secret values are emitted: the API base URL, the Cognito hosted-UI domain and
// the public SPA client id. The OpenRouter key lives in SSM and is never referenced here.
const fs = require('fs');
const path = require('path');

const required = ['API_BASE_URL', 'COGNITO_DOMAIN', 'COGNITO_CLIENT_ID'];
const config = {
  apiBaseUrl: (process.env.API_BASE_URL || '').replace(/\/+$/, ''),
  cognitoDomain: (process.env.COGNITO_DOMAIN || '').replace(/\/+$/, ''),
  clientId: process.env.COGNITO_CLIENT_ID || '',
  redirectUri: process.env.REDIRECT_URI || undefined
};

const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.warn(`[build-config] Missing environment variables: ${missing.join(', ')}.`);
  console.warn('[build-config] The app will render a configuration notice instead of signing in.');
}

const banned = Object.keys(process.env).filter(k => /OPENROUTER|OPENAI|SECRET|AWS_SECRET|PRIVATE/i.test(k));
for (const key of banned) {
  if (JSON.stringify(config).includes(process.env[key] || '\u0000')) {
    throw new Error(`[build-config] Refusing to emit a value that matches ${key}`);
  }
}

const out = path.join(__dirname, '..', 'config.js');
fs.writeFileSync(out, `window.PARCELPILOT_CONFIG=${JSON.stringify(config)};\n`);
console.log(`[build-config] Wrote ${path.relative(process.cwd(), out)}`);
