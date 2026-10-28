# Deployment and rollback

Prerequisites: AWS CLI with credentials, AWS SAM CLI, Node 22, Vercel CLI.
Pick a region once and use it everywhere (`us-east-1` below).

## 1. Deploy the backend

```bash
cd backend
npm install
npm test                       # unit, authorization and security suites must pass first
sam build
sam deploy --guided \
  --stack-name parcelpilot-prod \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides Stage=prod AllowedOrigin=https://PLACEHOLDER.vercel.app AlarmEmail=you@example.com
```

`AllowedOrigin` is a placeholder on the first pass because Vercel has not issued the
domain yet. Step 5 updates it.

Record the outputs:

```bash
aws cloudformation describe-stacks --stack-name parcelpilot-prod --region us-east-1 \
  --query 'Stacks[0].Outputs' --output table
```

## 2. Store the OpenRouter key in SSM

The key never appears in the template, in Git, or in any environment variable file.

```bash
aws ssm put-parameter --region us-east-1 \
  --name /parcelpilot/prod/openrouter-api-key \
  --type SecureString \
  --value "$OPENROUTER_KEY" \
  --overwrite
```

Rotating it later is the same command; the Lambda picks up the new value on its next cold
start, or immediately after `aws lambda update-function-configuration --function-name parcelpilot-api-prod --description "rotate $(date -u +%FT%TZ)"`.

## 3. Load the dataset into S3 and ingest

```bash
export DATASET_BUCKET=<DatasetBucketName output>
npm run ingest:upload                       # uploads source/*.pdf,*.xlsx and the snapshot
aws lambda invoke --region us-east-1 \
  --function-name <IngestFunctionName output> /dev/stdout
```

The Lambda re-parses the sources in place and rewrites `ingested.json`, so the deployed
snapshot is produced by the same code path that will serve it.

## 4. Create the Cognito users

```bash
export USER_POOL_ID=<UserPoolId output>
npm run seed:users
```

Passwords are generated, printed once and never stored. Put them in a password manager.

## 5. Deploy the frontend to Vercel

```bash
cd ../frontend
vercel link
vercel env add API_BASE_URL production       # <ApiBaseUrl output>
vercel env add COGNITO_DOMAIN production     # <CognitoDomain output>
vercel env add COGNITO_CLIENT_ID production  # <UserPoolClientId output>
vercel deploy --prod
```

Then close the CORS and redirect loop with the real domain:

```bash
cd ../backend
sam deploy --stack-name parcelpilot-prod --region us-east-1 \
  --capabilities CAPABILITY_IAM --no-confirm-changeset \
  --parameter-overrides Stage=prod AllowedOrigin=https://<your-app>.vercel.app AlarmEmail=you@example.com
```

This updates both the API Gateway `CorsConfiguration` and the Cognito client's callback
and logout URLs in one change set.

## 6. Verify every workflow

```bash
cd backend
export USER_POOL_ID=<UserPoolId> USER_POOL_CLIENT_ID=<UserPoolClientId>
export API_BASE_URL=<ApiBaseUrl> ALLOWED_ORIGIN=https://<your-app>.vercel.app
export CUSTOMER_PASSWORD=... SUPPORT_PASSWORD=... OPS_PASSWORD=...
eval "$(node scripts/test-env.js)"           # PowerShell: node scripts/test-env.js --powershell | iex
npm run test:integration
```

The suite covers the authorizer, tampered tokens, CORS, the S3 dataset, cancellation and
credit precedence, account isolation, Issue Radar role gating, privilege-escalation
attempts, the confirmation gate, token single-use, cross-identity confirmation, the
DynamoDB audit trail and the absence of any key in a response body.

Then exercise the UI once as each of the three users: cancellation review, credit
eligibility, ticket investigation, Issue Radar, and an action through prepare → confirm.

Confirm the alarm subscription email has been accepted, otherwise alarms fire into
nothing.

## 7. Retire Render

Only after step 6 passes end to end:

1. Keep the Render service running but take it out of any DNS or bookmark path.
2. Watch CloudWatch for 48 hours: `parcelpilot-prod-api-5xx`, `-api-4xx`,
   `-lambda-errors`, `-lambda-throttles` should stay in `OK`.
3. Delete the Render service and remove its environment variables, including the
   OpenRouter key stored there.

## Rollback

**Frontend** — instant, no data involved:

```bash
vercel rollback          # or promote a previous deployment from the Vercel dashboard
```

**Backend** — CloudFormation rolls back automatically on a failed deploy. To undo a
successful one, redeploy the previous commit:

```bash
git checkout <previous-sha> -- backend/
cd backend && sam build && sam deploy --stack-name parcelpilot-prod --region us-east-1 \
  --capabilities CAPABILITY_IAM --no-confirm-changeset \
  --parameter-overrides Stage=prod AllowedOrigin=https://<your-app>.vercel.app AlarmEmail=you@example.com
```

**Dataset** — the bucket is versioned, so a bad ingest is reversible:

```bash
aws s3api list-object-versions --bucket $DATASET_BUCKET --prefix ingested.json
aws s3api copy-object --bucket $DATASET_BUCKET --key ingested.json \
  --copy-source "$DATASET_BUCKET/ingested.json?versionId=<previous>"
```

**Audit data** — `ActionsTable` and `DatasetBucket` carry `DeletionPolicy: Retain`, so
deleting the stack never destroys the audit trail or the sources. The table has
point-in-time recovery for a 35-day restore window.

**Full revert to Render** — the Render service is self-contained; redeploy the commit
before this migration and restore its `OPENROUTER_API_KEY` environment variable. Actions
recorded in DynamoDB during the AWS window stay in DynamoDB; export them first with
`GET /api/actions` per account if they need to move.

## Emergency switches

| Need | Command |
| --- | --- |
| Stop all API traffic | `aws lambda put-function-concurrency --function-name parcelpilot-api-prod --reserved-concurrent-executions 0` |
| Lower the rate limit | redeploy with `RateLimit=2 BurstLimit=4` |
| Disable the model provider (fall back to the deterministic engine) | `aws ssm delete-parameter --name /parcelpilot/prod/openrouter-api-key` |
| Revoke a user | `aws cognito-idp admin-user-global-sign-out --user-pool-id $USER_POOL_ID --username <email>` |
