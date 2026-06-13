import { describe, expect, it } from "vitest";
import entry from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

describe("mysql-mcp-guard", () => {
  it("declares tool metadata", () => {
    expect(getToolPluginMetadata(entry)?.tools.map((tool) => tool.name)).toEqual([
      "mysql_mcp_guard_query",
      "mysql_mcp_guard_list_tables",
      "mysql_mcp_guard_describe_table",
      "mysql_mcp_guard_count_estimate",
    ]);
  });
});
