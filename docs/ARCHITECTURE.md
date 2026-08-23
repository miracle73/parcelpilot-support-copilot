# Architecture note

## Agent and tools

The OpenAI Agents SDK runs the model/tool loop and structured output. It chooses among scoped document retrieval, order/ticket lookup, deterministic policy calculation, and internal issue detection. The application then exposes confirmation-gated escalation, ticket update, or follow-up. When no API key is configured, the deterministic orchestrator remains available for reproducible review.

## Data handling

`npm run ingest` parses all six PDFs and the workbook into `data/ingested.json`. The workbook snapshot is the clock. Retrieval retains filename, type, customer scope, and authority. Customer filtering happens inside lookup/retrieval functions.

## Reliability

Precedence is active customer agreement, current SOP/policy, current product guide, then historical tickets as context only. Deprecated policy has zero authority and is excluded. Conflicts are surfaced; missing evidence causes a qualified answer or escalation.

## Trade-offs

The hybrid design gains natural-language tool selection while keeping permissions, arithmetic, source precedence, and mutations outside the model. The no-key fallback is reproducible and offline. Local JSON action persistence and mock identities are demo choices, not production infrastructure.
