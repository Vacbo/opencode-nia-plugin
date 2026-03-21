

# Task 22 blocker research: `/advisor` contract decisions

- Treat the public docs page `https://docs.trynia.ai/api-reference/advisor/context-aware-code-advisor` as the source of truth for the next implementation pass because it exposes the current OpenAPI schema and matches live validation behavior.
- Ignore `instructions/nia-tools.md` for advisor request/response typing during the fix; that file is stale for this endpoint.
- The next fix must reshape the request around:
  - `query: string`
  - `codebase: { files?, file_tree?, dependencies?, git_diff?, summary?, focus_paths? }`
  - `search_scope?: { repositories?: string[]; data_sources?: string[] } | null`
  - `output_format?: 'explanation' | 'checklist' | 'diff' | 'structured'`
- The next fix must also revisit `src/api/types.ts` and response formatting because the live response contract is `{ advice, sources_searched, output_format }`, not `AdvisorResult.recommendations[]`.
- Evidence for the decision:
  - official OpenAPI docs show `codebase` and `search_scope` as object schemas
  - live `POST /v2/advisor` rejects string `codebase` and string `search_scope` with `422 model_attributes_type`
  - live `POST /v2/advisor` rejects `output_format="markdown"` with an enum validation error and accepts `checklist`
