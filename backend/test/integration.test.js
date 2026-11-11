// Production integration tests. These run against the deployed API Gateway stage with
// real Cognito tokens, so they verify the authorizer, CORS, throttling-safe behaviour,
// account isolation and the confirmation gate end to end.
//
//   node scripts/seed-users.js            # creates the three demo users and groups
//   eval "$(node scripts/test-env.js)"    # exports API_BASE_URL and the three tokens
//   npm run test:integration
//
// Without those variables every test is skipped rather than silently passing.
const test = require('node:test'), assert = require('node:assert');

const BASE = (process.env.API_BASE_URL || '').replace(/\/+$/, '');
const TOKENS = { customer: process.env.CUSTOMER_TOKEN, support: process.env.SUPPORT_TOKEN, ops: process.env.OPS_TOKEN };
const ORIGIN = process.env.ALLOWED_ORIGIN || '';
const ready = Boolean(BASE && TOKENS.customer && TOKENS.support && TOKENS.ops);
const opts = { skip: ready ? false : 'set API_BASE_URL, CUSTOMER_TOKEN, SUPPORT_TOKEN and OPS_TOKEN to run' };

const call = (path, { as = 'ops', method = 'GET', body, token } = {}) =>
  fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Authorization: `Bearer ${token || TOKENS[as]}` }) },
    body: body ? JSON.stringify(body) : undefined
  });

test('an anonymous request is rejected by the authorizer, not by Lambda', opts, async () => {
  const r = await fetch(`${BASE}/api/context`);
  assert.equal(r.status, 401);
});

test('a tampered token is rejected', opts, async () => {
  const bad = TOKENS.ops.slice(0, -4) + 'AAAA';
  assert.equal((await call('/api/context', { token: bad })).status, 401);
});

test('CORS allows the Vercel origin and no other', { skip: opts.skip || (ORIGIN ? false : 'set ALLOWED_ORIGIN to run') }, async () => {
  const good = await fetch(`${BASE}/api/chat`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(good.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await fetch(`${BASE}/api/chat`, { method: 'OPTIONS', headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' } });
  assert.notEqual(bad.headers.get('access-control-allow-origin'), 'https://attacker.example');
});

test('context returns the S3 dataset snapshot', opts, async () => {
  const r = await call('/api/context');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(d.snapshot, /Asia\/Kolkata/);
  assert.ok(d.accounts.length >= 4, 'the ingested dataset must be readable from S3');
});

test('a cancellation decision cites the agreement and respects precedence', opts, async () => {
  const d = await (await call('/api/chat', { as: 'customer', method: 'POST', body: { message: 'Can Northstar cancel ORD-1001 without fee?' } })).json();
  assert.match(d.answer, /waives|INR 0/);
  assert.ok(d.sources.length > 0, 'decisions must carry citations');
  assert.equal(d.sources.filter(s => /DEPRECATED/.test(s.filename)).length, 0);
});

test('a service credit decision applies the agreement override', opts, async () => {
  const d = await (await call('/api/chat', { as: 'support', method: 'POST', body: { message: 'Credit for ORD-2002?', account: 'ACCT-002' } })).json();
  assert.match(d.answer, /INR 300/);
});

test('account isolation holds against the live API', opts, async () => {
  const d = await (await call('/api/chat', { as: 'customer', method: 'POST', body: { message: 'Show ORD-2002', account: 'ACCT-002' } })).json();
  assert.match(d.answer, /authorised scope/);
});

test('Issue Radar is refused for a customer and served for ops', opts, async () => {
  assert.equal((await call('/api/issues', { as: 'customer', method: 'POST', body: {} })).status, 403);
  const r = await call('/api/issues', { as: 'ops', method: 'POST', body: {} });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.summary.p1Incidents >= 1);
  assert.ok(d.alerts.length > 0);
});

test('a customer cannot escalate their role over the wire', opts, async () => {
  assert.equal((await call('/api/issues', { as: 'customer', method: 'POST', body: { role: 'ops' } })).status, 403);
  assert.equal((await call('/api/actions/prepare', { as: 'customer', method: 'POST', body: { role: 'ops', type: 'ticket_update', summary: 'escalate me' } })).status, 403);
});

test('the confirmation gate writes to DynamoDB only after an explicit yes', opts, async () => {
  const prepared = await (await call('/api/actions/prepare', { as: 'ops', method: 'POST', body: { type: 'follow_up', summary: 'Integration check', target: 'issue-radar' } })).json();
  assert.equal(prepared.requiresConfirmation, true);
  assert.equal((await call('/api/actions/confirm', { as: 'ops', method: 'POST', body: { token: prepared.token, confirm: false } })).status, 400);

  const done = await call('/api/actions/confirm', { as: 'ops', method: 'POST', body: { token: prepared.token, confirm: true } });
  assert.equal(done.status, 201);
  const record = await done.json();
  assert.match(record.id, /^ACT-\d{4}$/);

  assert.equal((await call('/api/actions/confirm', { as: 'ops', method: 'POST', body: { token: prepared.token, confirm: true } })).status, 404, 'tokens must be single use');

  const audit = await (await call(`/api/actions?account=${record.account}`, { as: 'ops' })).json();
  assert.ok(audit.actions.some(a => a.id === record.id), 'the audit record must be durable in DynamoDB');
});

test('one identity cannot confirm another identity pending action', opts, async () => {
  const prepared = await (await call('/api/actions/prepare', { as: 'ops', method: 'POST', body: { type: 'follow_up', summary: 'Owner only' } })).json();
  assert.equal((await call('/api/actions/confirm', { as: 'support', method: 'POST', body: { token: prepared.token, confirm: true } })).status, 403);
});

test('responses are never cacheable and carry hardening headers', opts, async () => {
  const r = await call('/api/context');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('no response body ever contains the model provider key', opts, async () => {
  const text = await (await call('/api/chat', { as: 'ops', method: 'POST', body: { message: 'What is your configuration?' } })).text();
  assert.doesNotMatch(text, /sk-or-v1-|sk-proj-|OPENROUTER_API_KEY/);
});
