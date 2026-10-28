// In-memory DynamoDB double. It implements only the access patterns src/store.js uses,
// which keeps the handler tests honest about keys, conditions and TTL without a network.
const aws = require('../src/aws');

function fakeDynamo() {
  const items = new Map();
  const key = i => `${i.pk}|${i.sk}`;
  return {
    items,
    send: async cmd => {
      const name = cmd.constructor.name;
      const input = cmd.input;
      if (name === 'PutCommand') {
        const k = key(input.Item);
        if (/attribute_not_exists\(pk\) OR attribute_not_exists\(sk\)/.test(input.ConditionExpression || '') && items.has(k)) {
          const e = new Error('ConditionalCheckFailedException'); e.name = 'ConditionalCheckFailedException'; throw e;
        }
        items.set(k, { ...input.Item });
        return {};
      }
      if (name === 'GetCommand') {
        const found = items.get(key(input.Key));
        return found ? { Item: { ...found } } : {};
      }
      if (name === 'DeleteCommand') {
        const k = key(input.Key);
        if (/attribute_exists\(pk\)/.test(input.ConditionExpression || '') && !items.has(k)) {
          const e = new Error('ConditionalCheckFailedException'); e.name = 'ConditionalCheckFailedException'; throw e;
        }
        items.delete(k);
        return {};
      }
      if (name === 'UpdateCommand') {
        const k = key(input.Key);
        const current = items.get(k) || { ...input.Key, value: 0 };
        current.value = (current.value || 0) + input.ExpressionAttributeValues[':one'];
        items.set(k, current);
        return { Attributes: { value: current.value } };
      }
      if (name === 'QueryCommand') {
        const pk = input.ExpressionAttributeValues[':p'];
        const prefix = input.ExpressionAttributeValues[':s'] || '';
        const matched = [...items.values()].filter(i => i.pk === pk && String(i.sk).startsWith(prefix));
        matched.sort((a, b) => (input.ScanIndexForward === false ? String(b.sk).localeCompare(a.sk) : String(a.sk).localeCompare(b.sk)));
        return { Items: matched.slice(0, input.Limit || matched.length) };
      }
      throw new Error(`Unsupported command in test double: ${name}`);
    }
  };
}

// Installs the double before src/store.js is first required, since store.js captures the
// client factory at module load.
function installFakeDynamo() {
  const fake = fakeDynamo();
  aws.DDB = () => fake;
  process.env.TABLE_NAME = process.env.TABLE_NAME || 'parcelpilot-actions-test';
  return fake;
}

// Builds the API Gateway HTTP API v2 event shape, including the JWT claims the Cognito
// authorizer injects. Tests can therefore forge *claims* but never forge a signature,
// which mirrors what an attacker can and cannot do.
function event({ method = 'POST', path = '/api/chat', body, query, groups = ['customer'], account = 'ACCT-001', sub = 'user-1', email = 'user@example.test', noAuth = false } = {}) {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    queryStringParameters: query,
    requestContext: {
      http: { method, path },
      authorizer: noAuth ? undefined : { jwt: { claims: { sub, email, 'cognito:groups': groups, 'custom:account': account } } }
    }
  };
}

const parse = r => JSON.parse(r.body);

module.exports = { fakeDynamo, installFakeDynamo, event, parse };
