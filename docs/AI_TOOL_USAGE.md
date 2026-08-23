# AI tool usage

OpenAI Codex was used to inspect the assessment, implement the application, build ingestion and tests, and audit coverage. The runtime uses the OpenAI Agents SDK with typed function tools and structured output when `OPENAI_API_KEY` is set. A deterministic fallback keeps it runnable without credentials; privacy, calculations, precedence, and action confirmation remain code-enforced.
