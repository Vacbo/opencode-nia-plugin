export const TOOL_NAMES = {
  search: "nia_search",
  read: "nia_read",
  grep: "nia_grep",
  explore: "nia_explore",
  index: "nia_index",
  manage_resource: "nia_manage_resource",
  research: "nia_research",
  advisor: "nia_advisor",
  context: "nia_context",
  package_search: "nia_package_search",
  auto_subscribe: "nia_auto_subscribe",
  tracer: "nia_tracer",
  e2e: "nia_e2e",
} as const;

export const NIA_TOOLS_LIST = Object.values(TOOL_NAMES).join(", ");

