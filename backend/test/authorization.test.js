const test = require('node:test'), assert = require('node:assert');
const { identity, scope } = require('../src/auth');
const { event } = require('./helpers');
const { DATA } = require('../src/data');

const accounts = DATA.accounts;

test('no JWT claims means no identity', () => {
  assert.equal(identity(event({ noAuth: true })), null);
  assert.equal(identity({}), null);
});

test('role comes from the Cognito group, not the request', () => {
  const who = identity(event({ groups: ['support'] }));
  assert.equal(who.role, 'support');
  assert.equal(who.account, 'ACCT-001');
});

test('the highest granted group wins when several are present', () => {
  assert.equal(identity(event({ groups: ['customer', 'ops', 'support'] })).role, 'ops');
});

test('groups delivered as a bracketed string are parsed', () => {
  const ev = event({ groups: 'support' });
  ev.requestContext.authorizer.jwt.claims['cognito:groups'] = '[support ops]';
  assert.equal(identity(ev).role, 'ops');
});

test('unknown groups never grant a role', () => {
  assert.equal(identity(event({ groups: ['admin', 'superuser'] })).role, 'customer');
});

test('a customer cannot raise their role through the request body', () => {
  const who = identity(event({ groups: ['customer'] }));
  const u = scope(who, { role: 'ops' }, accounts);
  assert.equal(u.role, 'customer');
});

test('a support agent cannot become ops', () => {
  const u = scope(identity(event({ groups: ['support'] })), { role: 'ops' }, accounts);
  assert.equal(u.role, 'support');
});

test('staff may step down to reproduce the customer view', () => {
  const u = scope(identity(event({ groups: ['ops'] })), { role: 'customer' }, accounts);
  assert.equal(u.role, 'customer');
  assert.equal(u.grantedRole, 'ops');
});

test('a customer is pinned to the account on their token', () => {
  const u = scope(identity(event({ groups: ['customer'], account: 'ACCT-001' })), { account: 'ACCT-002' }, accounts);
  assert.equal(u.account, 'ACCT-001');
});

test('staff may scope to another known account', () => {
  const u = scope(identity(event({ groups: ['support'], account: 'ACCT-001' })), { account: 'ACCT-002' }, accounts);
  assert.equal(u.account, 'ACCT-002');
});

test('an unknown account falls back instead of leaking', () => {
  const u = scope(identity(event({ groups: ['ops'], account: 'ACCT-999' })), { account: 'ACCT-999' }, accounts);
  assert.ok(accounts[u.account], 'effective account must exist in the dataset');
});

test('a staff member stepping down to customer keeps the narrowed scope', () => {
  const u = scope(identity(event({ groups: ['support'], account: 'ACCT-001' })), { role: 'customer', account: 'ACCT-002' }, accounts);
  assert.equal(u.role, 'customer');
  assert.equal(u.account, 'ACCT-002', 'staff retain cross-account visibility they already had');
});
