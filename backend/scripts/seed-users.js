#!/usr/bin/env node
// Creates the three demo users (customer, support, ops) in the deployed Cognito user pool
// and binds each one to an account. Passwords are generated here, printed once, and never
// written to a file or committed. Requires AWS credentials and USER_POOL_ID.
const crypto = require('crypto');
const {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand, AdminDeleteUserCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const UserPoolId = process.env.USER_POOL_ID;
const domain = process.env.DEMO_EMAIL_DOMAIN || 'parcelpilot.test';
if (!UserPoolId) { console.error('Set USER_POOL_ID (see the SAM stack outputs)'); process.exit(1); }

const client = new CognitoIdentityProviderClient({});
const password = () => `Pp${crypto.randomBytes(12).toString('base64url')}!9`;

const users = [
  { group: 'customer', account: 'ACCT-001', email: `customer@${domain}` },
  { group: 'support', account: 'ACCT-001', email: `support@${domain}` },
  { group: 'ops', account: 'ACCT-001', email: `ops@${domain}` }
];

(async () => {
  const created = [];
  for (const u of users) {
    if (process.argv.includes('--recreate')) {
      try { await client.send(new AdminDeleteUserCommand({ UserPoolId, Username: u.email })) } catch { }
    }
    const pw = password();
    try {
      await client.send(new AdminCreateUserCommand({
        UserPoolId, Username: u.email, MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: u.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:account', Value: u.account }
        ]
      }));
    } catch (e) {
      if (e.name !== 'UsernameExistsException') throw e;
      console.log(`${u.email} already exists; resetting its password`);
    }
    await client.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: u.email, Password: pw, Permanent: true }));
    await client.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: u.email, GroupName: u.group }));
    created.push({ ...u, password: pw });
  }
  console.log('\nDemo users ready. Store these in your password manager; they are not saved anywhere:\n');
  for (const u of created) console.log(`  ${u.group.padEnd(8)} ${u.email}  ${u.password}  (${u.account})`);
  console.log('\nExport them for the integration tests:\n');
  for (const u of created) console.log(`  export ${u.group.toUpperCase()}_PASSWORD='${u.password}'`);
})().catch(e => { console.error(e); process.exit(1) });
