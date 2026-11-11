# Estimated monthly cost

`us-east-1`, on-demand pricing as of October 2026. Figures are the steady-state cost of
the architecture, excluding OpenRouter model usage, which is billed by OpenRouter and
depends entirely on traffic.

## Assumptions

Demo / low-traffic profile: 10,000 API requests a month, average 1.5 s of Lambda time at
1024 MB on arm64, 20,000 DynamoDB writes and 20,000 reads, 50 MB in S3, one ingestion run
a week, 1 GB of CloudWatch logs ingested at 7-day retention.

## Breakdown

| Service | Driver | Monthly |
| --- | --- | --- |
| Lambda (API) | 10k invocations × 1.5 s × 1 GB arm64 = 15,000 GB-s | **$0.00** (free tier: 400,000 GB-s) |
| Lambda (ingest) | ~4 runs × 60 s × 1.5 GB = 360 GB-s | **$0.00** |
| API Gateway HTTP API | 10k requests at $1.00 / million | **$0.01** |
| DynamoDB on-demand | 20k writes ($1.25/M) + 20k reads ($0.25/M) | **$0.03** |
| DynamoDB storage + PITR | < 1 GB | **$0.25** |
| S3 Standard | 50 MB + a few hundred GET/PUT | **$0.01** |
| Cognito | 3–50 monthly active users | **$0.00** (free tier: 10,000 MAU) |
| SSM Parameter Store | standard SecureString, ~1k reads | **$0.00** |
| CloudWatch Logs | 1 GB ingested ($0.50) + 7-day storage | **$0.51** |
| CloudWatch alarms | 4 standard alarms × $0.10 | **$0.40** |
| X-Ray | 10k traces, first 100k free | **$0.00** |
| SNS | a handful of email notifications | **$0.00** |
| AWS Budgets | first two budgets free | **$0.00** |
| Vercel Hobby | static site | **$0.00** |
| **Total** | | **≈ $1.20 / month** |

Outside the Lambda free tier (for example 1,000,000 requests a month, 1.5 s each), the
same stack lands near **$26 / month**: $24 Lambda, $1 API Gateway, ~$1.50 DynamoDB, plus
the fixed $0.90 of alarms and logs. API Gateway throttling at 20 rps and
`ReservedConcurrentExecutions: 20` cap the worst case at roughly 52 million GB-seconds a
month if something ran flat out, which is why the budget alert exists.

## Comparison with the alternatives that were rejected

| Option | Monthly | Why not |
| --- | --- | --- |
| **This stack** | ~$1.20 | scales to zero |
| Render Starter (previous) | $7.00 | always-on web service, no scale to zero |
| ECS Fargate (0.25 vCPU, 0.5 GB, always on) | ~$9.00 | always-on |
| EC2 t4g.small | ~$12.00 | always-on, patching |
| + NAT Gateway | +$32.00 | charged per hour plus per GB; avoided entirely by keeping Lambda out of a VPC |
| + RDS db.t4g.micro | +$12.00 | DynamoDB on-demand covers the access patterns at $0.28 |

## Cost controls in the template

- `Architectures: [arm64]` — about 20% cheaper per GB-second than x86.
- `BillingMode: PAY_PER_REQUEST` — no provisioned DynamoDB capacity.
- No `ProvisionedConcurrency` — cold starts are accepted in exchange for zero idle cost.
- No VPC configuration — avoids the $32/month NAT Gateway outright.
- `LogRetentionDays: 7` on all three log groups.
- `NoncurrentVersionExpirationInDays: 30` and a 3-day incomplete-upload abort on the bucket.
- `ReservedConcurrentExecutions: 20` plus 20 rps / 40 burst API throttling.
- A monthly AWS Budget (default $10) alerting at 80% actual and 100% forecast.

## What to watch

CloudWatch Logs is the item most likely to grow: it is the only line that scales with
verbosity rather than traffic. If it climbs, reduce logging in `src/handlers/index.js`
rather than extending retention.
