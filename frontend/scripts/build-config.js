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

// Guard against a secret being wired into one of the public variables by mistake. Only
// values long enough to be real credentials are compared, so short build-platform flags
// such as NEXT_PRIVATE_MULTI_PAYLOAD=1 cannot trip it.
const emitted = JSON.stringify(config);
const sensitive = /^(OPENROUTER|OPENAI)|_?(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)$/i;
for (const [key, value] of Object.entries(process.env)) {
  if (!sensitive.test(key) || !value || value.length < 12) continue;
  if (emitted.includes(value)) throw new Error(`[build-config] Refusing to emit a value that matches ${key}`);
}
if (/sk-or-v1-|sk-proj-|AKIA[0-9A-Z]{16}/.test(emitted)) {
  throw new Error('[build-config] Refusing to emit what looks like a credential');
}

const out = path.join(__dirname, '..', 'config.js');
fs.writeFileSync(out, `window.PARCELPILOT_CONFIG=${JSON.stringify(config)};\n`);
console.log(`[build-config] Wrote ${path.relative(process.cwd(), out)}`);
