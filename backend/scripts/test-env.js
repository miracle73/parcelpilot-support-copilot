#!/usr/bin/env node
// Mints real Cognito ID tokens for the three demo users and prints shell exports for the
// integration suite. Uses ADMIN_USER_PASSWORD_AUTH, which needs AWS credentials, so this
// never runs in a browser. Tokens are short-lived and are not written to disk.
//
//   eval "$(node scripts/test-env.js)"      # bash
//   node scripts/test-env.js | iex          # PowerShell (with --powershell)
const { CognitoIdentityProviderClient, AdminInitiateAuthCommand } = require('@aws-sdk/client-cognito-identity-provider');

const { USER_POOL_ID, USER_POOL_CLIENT_ID, API_BASE_URL, ALLOWED_ORIGIN } = process.env;
const domain = process.env.DEMO_EMAIL_DOMAIN || 'parcelpilot.test';
const missing = ['USER_POOL_ID', 'USER_POOL_CLIENT_ID', 'API_BASE_URL'].filter(k => !process.env[k]);
if (missing.length) { console.error(`Set ${missing.join(', ')} from the SAM stack outputs`); process.exit(1); }

const client = new CognitoIdentityProviderClient({});
const ps = process.argv.includes('--powershell');
const line = (k, v) => (ps ? `$env:${k}='${v}'` : `export ${k}='${v}'`);

(async () => {
  const out = [line('API_BASE_URL', API_BASE_URL)];
  if (ALLOWED_ORIGIN) out.push(line('ALLOWED_ORIGIN', ALLOWED_ORIGIN));
  for (const role of ['customer', 'support', 'ops']) {
    const password = process.env[`${role.toUpperCase()}_PASSWORD`];
    if (!password) { console.error(`Set ${role.toUpperCase()}_PASSWORD (printed by scripts/seed-users.js)`); process.exit(1); }
    const r = await client.send(new AdminInitiateAuthCommand({
      UserPoolId: USER_POOL_ID, ClientId: USER_POOL_CLIENT_ID,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: `${role}@${domain}`, PASSWORD: password }
    }));
    if (!r.AuthenticationResult) throw new Error(`${role} sign-in returned a challenge: ${r.ChallengeName}`);
    out.push(line(`${role.toUpperCase()}_TOKEN`, r.AuthenticationResult.IdToken));
  }
  console.log(out.join('\n'));
})().catch(e => { console.error(e.message); process.exit(1) });
