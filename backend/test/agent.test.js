const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { runAgent } = require('../src/agent');
const { DATA, analyseIssues } = require('../src/data');
const customer = account => ({ role: 'customer', account });

test('confirmation cards use scoped one-time handlers', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'app.js'), 'utf8');
  assert.doesNotMatch(js, /id="confirmAction"/);
  assert.match(js, /confirm\(d\.token,e\.currentTarget\)/);
});
test('real pack loaded', () => { assert.equal(DATA.orders.length, 6); assert.equal(DATA.documents.length, 6); assert.match(DATA.snapshot, /Asia\/Kolkata/) });
test('OpenAI Agents SDK exposes four scoped tools', () => { let { agent } = require('../src/openai-agent'); assert.deepEqual(agent.tools.map(x => x.name), ['document_search', 'structured_lookup', 'policy_calculation', 'issue_detection']) });
test('Northstar contract overrides fee', () => assert.match(runAgent('Can Northstar cancel ORD-1001 without fee?', customer('ACCT-001')).answer, /waives/));
test('decision citations are unique', () => { let x = runAgent('Can Northstar cancel ORD-1001 without fee?', customer('ACCT-001')); assert.equal(new Set(x.sources.map(s => s.filename)).size, x.sources.length) });
test('picked-up uses RTO', () => assert.match(runAgent('Cancel ORD-1002', customer('ACCT-001')).answer, /return-to-origin/));
test('Lumen cancellation costs INR 250', () => assert.match(runAgent('Cancel ORD-2001', customer('ACCT-002')).answer, /INR 250/));
test('standard within 30 mins is free', () => assert.match(runAgent('Cancel ORD-3001', customer('ACCT-003')).answer, /Fee: INR 0/));
test('Lumen fixed credit override', () => assert.match(runAgent('Credit for ORD-2002?', customer('ACCT-002')).answer, /fixed INR 300/));
test('cross-account hidden', () => assert.match(runAgent('Show ORD-2002', customer('ACCT-001')).answer, /authorised scope/));
test('known issue matching', () => assert.match(runAgent('Investigate TKT-502', { role: 'support', account: 'ACCT-001' }).answer, /KI-208/));
test('customer ticket lookup remains private', () => assert.match(runAgent('Investigate TKT-502', customer('ACCT-001')).answer, /authorised scope/));
test('unsupported account change is low confidence and escalated', () => { let x = runAgent('Change my payment method', customer('ACCT-001')); assert.equal(x.confidence, 'low'); assert.equal(x.action.type, 'escalation') });
test('security ticket P1', () => assert.match(runAgent('Investigate TKT-505', { role: 'ops', account: 'ACCT-001' }).answer, /P1/));
test('radar detects priorities', () => { let x = analyseIssues(); assert(x.summary.slaBreaches > 0); assert(x.summary.knownIssueMatches > 0) });
test('deprecated policy never controls a decision', () => {
  const x = runAgent('Can Northstar cancel ORD-1001 without fee?', customer('ACCT-001'));
  assert.equal(x.sources.filter(s => /DEPRECATED/.test(s.filename)).length, 0);
  assert.match(x.trust.precedence, /Active agreement > current policy\/SOP/);
});
