# Requirements audit

## Migration requirements

| # | Requirement | Where it is met |
| --- | --- | --- |
| 1 | Separate frontend/backend code | `frontend/` (Vercel static) and `backend/` (Lambda); the old `server.js`, `public/` and `render.yaml` are gone |
| 2 | API routes as Lambda handlers | `backend/src/handlers/index.js` (six routes), `backend/src/handlers/ingest.js` |
| 3 | Frontend on Vercel | `frontend/vercel.json`, `frontend/scripts/build-config.js`, `frontend/package.json` |
| 4 | API Gateway + Vercel CORS | `template.yaml` → `Api.CorsConfiguration` (origins `AllowedOrigin` + `LocalOrigin`, headers `content-type`/`authorization`, methods GET/POST/OPTIONS); verified by the CORS integration test |
| 5 | Source data and ingestion on S3 | `DatasetBucket`, `src/ingest.js` shared by `IngestFunction` and `scripts/ingest.js --upload`; `src/data.js` reads `ingested.json` from S3 in Lambda |
| 6 | Actions/audit in DynamoDB | `src/store.js` on `ActionsTable` (on-demand): pending actions with TTL, immutable audit items per account, atomic `ACT-####` counter |
| 7 | OpenRouter key in SSM, never client-side | `src/aws.js` `getSecret` + `src/openai-agent.js` `ensureProvider`; SSM SecureString at `/parcelpilot/<stage>/openrouter-api-key`; asserted by three tests in `test/security.test.js` |
| 8 | Cognito auth and role/account authorization | `UserPool`, `UserPoolClient` (PKCE, no secret), three groups, immutable `custom:account`; `src/auth.js`; `frontend/auth.js`; `test/authorization.test.js` |
| 9 | Throttling, least-privilege IAM, encryption, alarms, budget | `DefaultRouteSettings` 20/40 rps, `ReservedConcurrentExecutions: 20`, per-ARN IAM statements, S3 AES256 + TLS-only policy, DynamoDB SSE + PITR, four alarms, `AWS::Budgets::Budget` |
| 10 | Production integration, security and authorization tests | `test/integration.test.js` (14), `test/security.test.js` (11), `test/authorization.test.js` (12), `test/api.test.js` (20) |
| 11 | Architecture, deployment, rollback, cost docs | `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/COSTS.md` |
| 12 | Deploy and verify before retiring Render | `docs/DEPLOYMENT.md` steps 1–7; Render is retired only after the integration suite and a manual pass of all five workflows |

## Constraints

| Constraint | Evidence |
| --- | --- |
| No EC2, ECS, RDS, NAT Gateway, always-on services | `test/security.test.js` — "no always-on or NAT-dependent infrastructure is declared" asserts the template contains none of those resource types, no `VpcConfig` and no `ProvisionedConcurrency` |
| Account isolation preserved | `src/data.js` `allowed`/`lookupOrder`/`lookupTicket`; immutable `custom:account`; customers cannot re-scope; `test/api.test.js` and `test/integration.test.js` both assert cross-account lookups stay hidden |
| Citations preserved | `src/agent.js` `cite()` dedupes and drops deprecated sources; `openai-agent.js` filters model-claimed filenames against the real dataset; tested in `agent.test.js` and `integration.test.js` |
| Policy precedence preserved | `runAgent` agreement-over-SOP logic unchanged; `safety_verification` re-runs it over any model answer; `trust.precedence` returned with every decision |
| Confirmation gates preserved | `prepare` writes only a TTL proposal; `confirm` requires `confirm: true`, a single-use token and the same identity; eight tests across `api.test.js` and `integration.test.js` |
| Ingestion preserved | Classification, authority scores and workbook parsing moved verbatim into `src/ingest.js`; `agent.test.js` asserts 6 documents, 6 orders and the Asia/Kolkata snapshot |
| Issue Radar preserved | `analyseIssues` unchanged; still refused to customers at the API edge |
| No secrets committed | `test/security.test.js` walks the backend tree for OpenRouter and AWS key patterns; `.gitignore` excludes `.env`, `samconfig.toml`, `config.js` |
| No AI attribution | No co-author or generated-by lines in commits or docs |

## Test counts

59 offline tests pass (`npm test`); 14 integration tests run against a deployed stage and
skip with an explanatory message when the environment is not set.

## Changes to behaviour

Two deliberate differences from the Render version:

1. **Role and account are no longer taken from request headers.** They come from the
   Cognito token. The UI selectors can still narrow scope, which keeps the demo
   workflows, but they cannot raise it.
2. **Pending actions live in DynamoDB with a 15-minute TTL** rather than an in-process
   `Map`, because Lambda containers are not shared. Tokens are now single-use and bound
   to the identity that prepared them, which the in-memory version did not enforce.
