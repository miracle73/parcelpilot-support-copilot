# ParcelPilot Support Copilot

A grounded support copilot for a logistics platform. It answers questions about orders,
tickets, cancellation fees and service credits using only the ingested policy pack, applies
contract-over-policy precedence in code rather than in the model, keeps every account
isolated, cites its evidence, and never acts without an explicit confirmation.

Runs as a serverless, scale-to-zero stack: a static frontend on Vercel and an AWS Lambda
API behind API Gateway with Cognito authentication. Steady-state cost is about **$1.20 a
month** (see [docs/COSTS.md](docs/COSTS.md)).

```
Vercel (static)  ──PKCE──►  Cognito  ──ID token──►  API Gateway HTTP API
                                                        └─► Lambda ─► S3 · SSM · DynamoDB · OpenRouter
```

## Layout

| Path | What it is |
| --- | --- |
| [`frontend/`](frontend) | Static site for Vercel: chat UI, Issue Radar, Cognito PKCE login |
| [`backend/`](backend) | Lambda API, SAM template, ingestion, tests |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design, API surface, authorization model, safety properties |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deploy, verify, retire Render, rollback, emergency switches |
| [`docs/COSTS.md`](docs/COSTS.md) | Per-service cost estimate and the controls that keep it there |
| [`docs/PRODUCT_NOTE.md`](docs/PRODUCT_NOTE.md) | Product reasoning |
| [`docs/REQUIREMENTS_AUDIT.md`](docs/REQUIREMENTS_AUDIT.md) | Requirement-by-requirement evidence |
| [`docs/AI_TOOL_USAGE.md`](docs/AI_TOOL_USAGE.md) | How AI tooling was used to build this |

## Local development

```bash
cd backend && npm install && npm test        # 59 offline tests
cp .env.example .env                         # add an OpenRouter key for the SDK agent
npm run dev                                  # API on http://localhost:3000
```

```bash
cd frontend && npm run dev                   # UI on http://localhost:5173
```

`backend/scripts/local.js` injects the JWT claims that API Gateway's Cognito authorizer
would normally supply, so the API can be exercised without a deployed stack. Set
`DEV_GROUPS` and `DEV_ACCOUNT` to switch role and account. Without the Cognito
environment variables the frontend shows a configuration notice instead of signing in,
so point it at a deployed stack to use the real login.

Re-ingest the source pack after changing any PDF or the workbook:

```bash
cd backend && npm run ingest                 # local snapshot
DATASET_BUCKET=<bucket> npm run ingest:upload  # also push sources + snapshot to S3
```

## Tests

```bash
cd backend
npm test                  # agent, API handler, authorization and security suites
npm run test:integration  # against a deployed stage; needs real Cognito tokens
```

| Suite | Covers |
| --- | --- |
| `test/agent.test.js` | policy precedence, credits, citations, account isolation, Issue Radar |
| `test/api.test.js` | every route, confirmation gate, token single-use and expiry, audit trail |
| `test/authorization.test.js` | role derivation from Cognito groups, privilege-escalation attempts |
| `test/security.test.js` | no key reachable client-side, JWT on every route, least-privilege IAM, encryption, no always-on resources |
| `test/integration.test.js` | the deployed API: authorizer, CORS, S3 dataset, DynamoDB audit, end-to-end workflows |

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short:

```bash
cd backend && sam build && sam deploy --guided
aws ssm put-parameter --name /parcelpilot/prod/openrouter-api-key --type SecureString --value "$KEY"
DATASET_BUCKET=<bucket> npm run ingest:upload
USER_POOL_ID=<pool> npm run seed:users
cd ../frontend && vercel deploy --prod
```
