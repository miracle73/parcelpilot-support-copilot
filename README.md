# ParcelPilot Support & Operations Copilot

Complete runnable assessment prototype for both customer and internal operations contexts.

## Run

```bash
npm install
npm run ingest
npm start
```

Open http://localhost:3000. Run verification with `npm test`.

Set `OPENROUTER_API_KEY` to run the OpenAI Agents SDK through OpenRouter. `OPENROUTER_MODEL` defaults to `openai/gpt-4.1-mini`. Direct OpenAI keys remain supported. Without a key, the API uses the deterministic fallback so reviewers can still run every workflow.

## Included

- Natural-language chat combining scoped order lookup, authority-ranked document search, rules, and calculations.
- Customer, support, and operations roles. Customer access is filtered in `src/data.js`; inaccessible and nonexistent IDs are indistinguishable.
- Visible document, structured-data, calculation, issue-detection, and action tools.
- Escalation, ticket-update, and follow-up actions. Each is previewed and saved to `data/actions.json` only after explicit confirmation.
- Precedence: customer agreement > SOP > current policy > product guide. Deprecated sources are excluded; historical resolutions are context only.
- Confidence labels and escalation for missing evidence, incomplete delivery, post-dispatch cancellation, and unsupported exceptions.
- Internal Issue Radar for SLA breaches, recurring topics, multi-account patterns, and high-severity work. Customer API calls are rejected.
- Dataset snapshot time used for every time calculation.

## Architecture

Browser → role/account-aware API → OpenAI Agents SDK orchestrator → scoped data/document tools and deterministic policy engine → confirmation-gated action store. A no-key fallback preserves local runnability.

## Real assessment data

All six supplied PDFs and `ParcelPilot_Assessment_Data.xlsx` are in `data/source`. Run `npm run ingest` after replacing a source file. The application loads the generated dataset dynamically rather than hard-coding workbook records.

## Prioritised continuation

1. Add page-level citation metadata during ingestion.
2. Replace the mock identity selector with SSO and server-issued RBAC claims.
3. Add a constrained LLM planner while retaining deterministic permissions/calculations.
4. Expand privacy, conflict, citation, time, and confirmation evaluations.
5. Connect actions to the ticket platform with idempotency and immutable audit logs.

## Five-minute demo

1. Explain trust hierarchy and data-layer access control.
2. Ask as Northstar whether ORD-1001 can cancel free; show contract override and citations.
3. Ask for ORD-1002 as Northstar; show privacy-safe denial.
4. Switch to LumenWorks, calculate ORD-2002 credit, prepare it, and explicitly confirm.
5. Switch to Operations and open Issue Radar for SLA and cross-account patterns.
