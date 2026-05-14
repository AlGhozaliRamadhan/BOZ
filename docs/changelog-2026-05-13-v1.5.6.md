# BOZ v1.5.6 Changelog

**Date:** May 13, 2026

## Added

- **Schema-validated JSON outputs for all AI responses:**
  - Market analysis and News Intel now require JSON output with strict schema validation (Ajv).
  - Invalid JSON or schema mismatches fall back safely with warnings.
  - Files: `src/services/llm.schemas.ts`, `src/services/llm.adapter.ts`, `src/services/ai.service.ts`, `src/analyzers/news.intel.analyzer.ts`
- **Integration test for agent loop + tool gating paths:**
  - Adds a fake adapter to validate tool call flow and finish handling.
  - File: `tests/base.agent.integration.test.ts`

## Changed

- **Unified LLM calls behind a hardened adapter:**
  - Centralized provider dispatch, JSON extraction, and offline tool-call simulation.
  - File: `src/services/llm.adapter.ts`
- **Agent prompt/docs alignment:**
  - News Intel Agent now states actual loop caps (80 steps, 20 min, soft nudge at 15 min).
  - README updated to reflect JSON outputs and correct tool count.
  - Files: `src/agents/news.intel.agent.ts`, `README.md`
- **AIService JSON schema parsing replaces regex parsing:**
  - Prediction parsing now uses schema-validated JSON (no text/regex extraction).
  - File: `src/services/ai.service.ts`

## Tests

- **AI parsing tests migrated to JSON:**
  - File: `tests/ai.service.test.ts`

## Dependencies

- **Added Ajv for JSON schema validation:**
  - File: `package.json`

## Notes

- This release hardens AI output reliability, reduces parsing brittleness, and unifies provider behavior across services and agents.
