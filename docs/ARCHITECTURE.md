# ParcelPilot Support Copilot — production architecture

## Shape

```
Browser ──► Vercel (static frontend)
   │          index.html · app.js · auth.js · config.js (built from env vars)
   │
   ├── OAuth 2.0 code + PKCE ──► Cognito hosted UI ──► ID token (sessionStorage, 60 min)
   │
   └── fetch + Bearer ID token ──► API Gateway HTTP API
                                      │ JWT authorizer (Cognito user pool)
                                      │ throttling 20 rps / 40 burst
                                      ▼
                                   Lambda  parcelpilot-api  (Node 22, arm64, 1024 MB)
                                      ├── S3   dataset snapshot  (ingested.json, read-only)
                                      ├── SSM  OpenRouter key    (SecureString, decrypt on read)
                                      ├── DynamoDB  pending actions (TTL) + audit records
                                      └── OpenRouter via OpenAI Agents SDK
                                   Lambda  parcelpilot-ingest  (manual / scheduled)
                                      └── S3 source/*.pdf,*.xlsx ──► S3 ingested.json
```

Nothing runs when nobody is using it. There is no EC2, ECS, RDS, NAT Gateway, load
balancer, VPC or provisioned concurrency anywhere in the stack — `test/security.test.js`
asserts this against the template so it cannot regress.

## Repository layout

| Path | Purpose |
| --- | --- |
| `frontend/` | Static site deployed to Vercel. No build output beyond `config.js`. |
| `frontend/auth.js` | Cognito PKCE login, token storage, authenticated `fetch` wrapper. |
| `frontend/scripts/build-config.js` | Vercel build step; emits only non-secret config. |
| `backend/template.yaml` | AWS SAM stack: API, Lambdas, Cognito, DynamoDB, S3, alarms, budget. |
| `backend/src/handlers/index.js` | Single Lambda router for all six API routes. |
| `backend/src/handlers/ingest.js` | Ingestion Lambda: S3 sources → S3 snapshot. |
| `backend/src/auth.js` | Derives role and account from verified JWT claims. |
| `backend/src/agent.js` | Deterministic policy engine (unchanged decision logic). |
| `backend/src/openai-agent.js` | OpenAI Agents SDK over OpenRouter, key from SSM. |
| `backend/src/store.js` | DynamoDB pending actions and audit trail. |
| `backend/src/data.js` | Dataset loader (S3 in Lambda, committed snapshot offline). |

## API

All routes require a valid Cognito ID token. The authorizer rejects anonymous and
tampered tokens before the Lambda is invoked, so an unauthenticated request costs nothing.

| Route | Who | Behaviour |
| --- | --- | --- |
| `GET /api/context` | any signed-in user | dataset snapshot and account list |
| `POST /api/chat` | any signed-in user | agent answer with citations and confidence |
| `POST /api/issues` | support, ops | Issue Radar |
| `POST /api/actions/prepare` | any; customers limited to `escalation` | returns a single-use token, writes nothing |
| `POST /api/actions/confirm` | the identity that prepared it | executes and writes the audit record |
| `GET /api/actions` | own account only for customers | audit trail |

## Authorization model

Identity comes only from the JWT claims that API Gateway places on the event:

- **Role** is the highest Cognito group the user is in (`customer` < `support` < `ops`).
  Unknown groups grant nothing.
- **Account** is `custom:account`, an immutable, admin-written attribute.

A request body or query string can only *narrow* scope. A customer may not raise their
role and may not leave their own account; staff may step down to the customer view or
inspect another account, which is read access they already hold. `test/authorization.test.js`
covers each direction, including a customer sending `{"role":"ops"}`.

## Safety properties preserved from the Render version

- **Account isolation** — enforced inside `lookupOrder`, `lookupTicket` and
  `searchDocuments`, and now also at the identity layer by the immutable `custom:account`
  attribute.
- **Citations** — every consequential answer carries `sources`; deprecated documents are
  filtered out of the decision and reported separately as excluded.
- **Policy precedence** — active agreement > current policy/SOP > current product guide >
  historical tickets. The model never decides this: `policy_calculation` and the
  `safety_verification` pass re-run the deterministic engine and overwrite the model's
  answer for any order, ticket, cancellation, credit or action request.
- **Confirmation gates** — `prepare` only stores a proposal (DynamoDB, 15-minute TTL);
  nothing is written to the audit trail without `confirm: true`. Tokens are single use
  (enforced by a conditional delete), expire, and may only be confirmed by the identity
  that prepared them.
- **Ingestion** — the same parsing rules now live in `src/ingest.js` and run both locally
  and in the ingestion Lambda, so authority scores and the deprecated/agreement/SOP
  classification are identical in both paths.
- **Issue Radar** — unchanged severity, SLA-age and known-issue logic, still refused to
  customers at the API boundary.

## Secrets

The OpenRouter key lives only in SSM Parameter Store as a `SecureString` at
`/parcelpilot/<stage>/openrouter-api-key`. The API Lambda holds `ssm:GetParameter` for
exactly that one parameter ARN and caches the value per container. It is never an
environment variable in the template, never returned in a response, and never present in
the frontend bundle — `test/security.test.js` asserts all three.

## Data

`ingested.json` is the single source of truth at runtime and is read from S3 once per
Lambda execution environment. The committed copy under `backend/data-source/` is used by
the offline unit tests and local development only.

## Cost controls

arm64 Lambda, DynamoDB on-demand, S3 Intelligent-free standard storage with versioning
expiry at 30 days, 7-day CloudWatch retention, `ReservedConcurrentExecutions: 20`,
API Gateway throttling at 20 rps, four CloudWatch alarms and a monthly AWS Budget with
actual-80% and forecast-100% alerts. See `docs/COSTS.md`.
