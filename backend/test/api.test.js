const test = require('node:test'), assert = require('node:assert');
const { installFakeDynamo, event, parse } = require('./helpers');

const store = installFakeDynamo();
const { handler } = require('../src/handlers/index');

const call = opts => handler(event(opts));

test('unauthenticated requests are rejected before any work happens', async () => {
  const r = await call({ method: 'GET', path: '/api/context', noAuth: true });
  assert.equal(r.statusCode, 401);
  assert.equal(parse(r).error, 'Authentication required');
});

test('unknown routes 404', async () => {
  const r = await call({ method: 'GET', path: '/api/secrets' });
  assert.equal(r.statusCode, 404);
});

test('context lists accounts and the dataset snapshot', async () => {
  const r = await call({ method: 'GET', path: '/api/context', groups: ['ops'] });
  const d = parse(r);
  assert.equal(r.statusCode, 200);
  assert.match(d.snapshot, /Asia\/Kolkata/);
  assert.ok(d.accounts.length >= 4);
});

test('responses carry hardening headers and are never cached', async () => {
  const r = await call({ method: 'GET', path: '/api/context', groups: ['ops'] });
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(r.headers['Strict-Transport-Security'], /max-age=31536000/);
});

test('chat falls back to the deterministic engine without a model provider', async () => {
  const r = await call({ path: '/api/chat', body: { message: 'Cancel ORD-1002' }, groups: ['customer'] });
  const d = parse(r);
  assert.equal(r.statusCode, 200);
  assert.match(d.answer, /return-to-origin/);
  assert.match(d.framework, /Deterministic/);
});

test('chat rejects an empty message', async () => {
  const r = await call({ path: '/api/chat', body: { message: '   ' }, groups: ['ops'] });
  assert.equal(r.statusCode, 400);
});

test('malformed JSON bodies produce 400, not 500', async () => {
  const ev = event({ path: '/api/chat', groups: ['ops'] });
  ev.body = '{not json';
  const r = await handler(ev);
  assert.equal(r.statusCode, 400);
});

test('account isolation holds across the HTTP boundary', async () => {
  const r = await call({ path: '/api/chat', body: { message: 'Show ORD-2002', account: 'ACCT-002' }, groups: ['customer'], account: 'ACCT-001' });
  assert.match(parse(r).answer, /authorised scope/);
});

test('Issue Radar requires support or ops', async () => {
  assert.equal((await call({ path: '/api/issues', groups: ['customer'] })).statusCode, 403);
  const ok = await call({ path: '/api/issues', groups: ['ops'] });
  assert.equal(ok.statusCode, 200);
  assert.ok(parse(ok).summary.slaBreaches > 0);
});

test('a customer claiming the ops role in the body is still refused Issue Radar', async () => {
  const r = await call({ path: '/api/issues', body: { role: 'ops' }, groups: ['customer'] });
  assert.equal(r.statusCode, 403);
});

test('a customer may only prepare an escalation', async () => {
  assert.equal((await call({ path: '/api/actions/prepare', body: { type: 'ticket_update', summary: 'x' }, groups: ['customer'] })).statusCode, 403);
  assert.equal((await call({ path: '/api/actions/prepare', body: { type: 'escalation', summary: 'x' }, groups: ['customer'] })).statusCode, 200);
});

test('an unknown action type is refused', async () => {
  assert.equal((await call({ path: '/api/actions/prepare', body: { type: 'delete_account', summary: 'x' }, groups: ['ops'] })).statusCode, 403);
});

test('preparing an action changes no state until it is confirmed', async () => {
  const prepared = parse(await call({ path: '/api/actions/prepare', body: { type: 'escalation', summary: 'Review ORD-1001' }, groups: ['customer'] }));
  assert.equal(prepared.requiresConfirmation, true);
  assert.equal([...store.items.values()].filter(i => i.entity === 'action').length, 0);

  const refused = await call({ path: '/api/actions/confirm', body: { token: prepared.token, confirm: false }, groups: ['customer'] });
  assert.equal(refused.statusCode, 400);
  assert.equal([...store.items.values()].filter(i => i.entity === 'action').length, 0, 'a declined confirmation must not execute');

  const done = await call({ path: '/api/actions/confirm', body: { token: prepared.token, confirm: true }, groups: ['customer'] });
  assert.equal(done.statusCode, 201);
  assert.match(parse(done).id, /^ACT-\d{4}$/);
});

test('a confirmation token is single use', async () => {
  const prepared = parse(await call({ path: '/api/actions/prepare', body: { type: 'escalation', summary: 'Once only' }, groups: ['customer'] }));
  assert.equal((await call({ path: '/api/actions/confirm', body: { token: prepared.token, confirm: true }, groups: ['customer'] })).statusCode, 201);
  assert.equal((await call({ path: '/api/actions/confirm', body: { token: prepared.token, confirm: true }, groups: ['customer'] })).statusCode, 404);
});

test('another identity cannot confirm an action it did not prepare', async () => {
  const prepared = parse(await call({ path: '/api/actions/prepare', body: { type: 'escalation', summary: 'Mine' }, groups: ['customer'], sub: 'user-a' }));
  const r = await call({ path: '/api/actions/confirm', body: { token: prepared.token, confirm: true }, groups: ['ops'], sub: 'user-b' });
  assert.equal(r.statusCode, 403);
});

test('an unknown or forged token is rejected', async () => {
  for (const token of ['not-a-token', '', null, { pk: 'PENDING#x' }]) {
    assert.equal((await call({ path: '/api/actions/confirm', body: { token, confirm: true }, groups: ['ops'] })).statusCode, 404);
  }
});

test('expired pending actions cannot be executed', async () => {
  const prepared = parse(await call({ path: '/api/actions/prepare', body: { type: 'escalation', summary: 'Stale' }, groups: ['customer'] }));
  const item = store.items.get(`PENDING#${prepared.token}|PENDING`);
  item.expiresAt = Math.floor(Date.now() / 1000) - 60;
  assert.equal((await call({ path: '/api/actions/confirm', body: { token: prepared.token, confirm: true }, groups: ['customer'] })).statusCode, 404);
});

test('audit records are written per account and read back in scope', async () => {
  const prepared = parse(await call({ path: '/api/actions/prepare', body: { type: 'follow_up', summary: 'Audited', account: 'ACCT-002' }, groups: ['ops'], sub: 'ops-1' }));
  await call({ path: '/api/actions/confirm', body: { token: prepared.token, confirm: true }, groups: ['ops'], sub: 'ops-1' });

  const mine = parse(await call({ method: 'GET', path: '/api/actions', query: { account: 'ACCT-002' }, groups: ['ops'], sub: 'ops-1' }));
  assert.equal(mine.account, 'ACCT-002');
  assert.ok(mine.actions.some(a => a.summary === 'Audited'));

  const other = parse(await call({ method: 'GET', path: '/api/actions', groups: ['customer'], account: 'ACCT-001' }));
  assert.equal(other.account, 'ACCT-001');
  assert.equal(other.actions.filter(a => a.account === 'ACCT-002').length, 0, 'a customer must never see another account audit trail');
});

test('a customer asking for another account audit trail is refused', async () => {
  const r = await call({ method: 'GET', path: '/api/actions', query: { account: 'ACCT-002' }, groups: ['customer'], account: 'ACCT-001' });
  assert.equal(r.statusCode, 403);
});

test('action ids increase monotonically', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const p = parse(await call({ path: '/api/actions/prepare', body: { type: 'escalation', summary: `seq ${i}` }, groups: ['customer'], sub: 'seq' }));
    ids.push(parse(await call({ path: '/api/actions/confirm', body: { token: p.token, confirm: true }, groups: ['customer'], sub: 'seq' })).id);
  }
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, 3);
});
