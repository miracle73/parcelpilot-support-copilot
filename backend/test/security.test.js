// Static guarantees about the deployed shape: no secret may reach the browser, the API
// must stay behind the Cognito authorizer, and the infrastructure must keep the low-cost,
// encrypted, least-privilege posture the migration committed to.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const frontend = path.join(root, '..', 'frontend');
const template = fs.readFileSync(path.join(root, 'template.yaml'), 'utf8');
const frontendFiles = fs.readdirSync(frontend).filter(f => /\.(js|html|json)$/.test(f) && f !== 'config.js');

test('no frontend file references a model provider key', () => {
  for (const file of frontendFiles) {
    const text = fs.readFileSync(path.join(frontend, file), 'utf8');
    assert.doesNotMatch(text, /OPENROUTER_API_KEY|OPENAI_API_KEY|sk-or-v1|sk-proj-/, `${file} must not reference a model provider key`);
  }
});

test('the frontend build only emits non-secret configuration', () => {
  const build = fs.readFileSync(path.join(frontend, 'scripts', 'build-config.js'), 'utf8');
  assert.match(build, /Refusing to emit a value/);
  assert.doesNotMatch(build, /OPENROUTER_API_KEY\s*\]?\s*:/);
});

test('the SPA client is public with PKCE and no secret', () => {
  assert.match(template, /GenerateSecret: false/);
  assert.match(template, /AllowedOAuthFlows: \[code\]/);
  const auth = fs.readFileSync(path.join(frontend, 'auth.js'), 'utf8');
  assert.match(auth, /code_challenge_method:'S256'/);
  assert.doesNotMatch(auth, /client_secret/);
  assert.doesNotMatch(auth, /localStorage/, 'tokens must not outlive the tab');
});

test('every API route sits behind the Cognito JWT authorizer', () => {
  assert.match(template, /DefaultAuthorizer: CognitoJwt/);
  assert.match(template, /issuer: !Sub https:\/\/cognito-idp\./);
  assert.doesNotMatch(template, /Auth:\s*\n\s*Authorizer: NONE/);
});

test('the OpenRouter key is read from SSM and never set as a plaintext value', () => {
  assert.match(template, /OPENROUTER_PARAMETER_NAME: !Sub \/parcelpilot\/\$\{Stage\}\/openrouter-api-key/);
  assert.doesNotMatch(template, /OPENROUTER_API_KEY:/);
  assert.match(template, /Action: \[ssm:GetParameter\]/);
});

test('IAM grants are scoped to single resources, never wildcards', () => {
  const resources = [...template.matchAll(/^\s+Resource: (.+)$/gm)].map(m => m[1].trim());
  const grants = resources.filter(r => !r.includes('aws:s3:::${DatasetBucket}\n'));
  for (const r of grants) {
    assert.doesNotMatch(r, /^['"]?\*['"]?$/, 'no IAM statement may grant Resource: *');
  }
  assert.match(template, /arn:aws:s3:::\$\{DatasetBucket\}\/ingested\.json/);
  assert.doesNotMatch(template, /Action: \[s3:\*\]/);
});

test('storage is encrypted, private and recoverable', () => {
  assert.match(template, /SSEAlgorithm: AES256/);
  assert.match(template, /BlockPublicAcls: true/);
  assert.match(template, /RestrictPublicBuckets: true/);
  assert.match(template, /aws:SecureTransport: false/);
  assert.match(template, /SSESpecification:\s*\n\s*SSEEnabled: true/);
  assert.match(template, /PointInTimeRecoveryEnabled: true/);
});

test('throttling, concurrency caps, alarms and a budget are in place', () => {
  assert.match(template, /ThrottlingRateLimit: !Ref RateLimit/);
  assert.match(template, /ThrottlingBurstLimit: !Ref BurstLimit/);
  assert.match(template, /ReservedConcurrentExecutions: !If \[CapConcurrency/);
  for (const alarm of ['api-5xx', 'api-4xx', 'lambda-errors', 'lambda-throttles']) {
    assert.ok(template.includes(alarm), `missing alarm ${alarm}`);
  }
  assert.match(template, /AWS::Budgets::Budget/);
});

test('no always-on or NAT-dependent infrastructure is declared', () => {
  for (const banned of ['AWS::EC2::Instance', 'AWS::ECS::', 'AWS::RDS::', 'AWS::EC2::NatGateway', 'AWS::ElasticLoadBalancingV2', 'AWS::EC2::VPC', 'ProvisionedConcurrency', 'VpcConfig']) {
    assert.ok(!template.includes(banned), `template must not declare ${banned}`);
  }
  assert.match(template, /BillingMode: PAY_PER_REQUEST/);
  assert.match(template, /Architectures: \[arm64\]/);
});

test('CloudWatch retention stays short', () => {
  assert.match(template, /Default: 7/);
  assert.equal((template.match(/RetentionInDays: !Ref LogRetentionDays/g) || []).length, 3);
});

test('no secret material is committed anywhere in the backend tree', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name === 'node_modules' || e.name === '.aws-sam' || e.name === 'data-source') return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  for (const file of walk(root)) {
    if (path.basename(file) === 'security.test.js') continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /sk-or-v1-[A-Za-z0-9]/, `${file} appears to contain an OpenRouter key`);
    assert.doesNotMatch(text, /AKIA[0-9A-Z]{16}/, `${file} appears to contain an AWS access key id`);
  }
});
