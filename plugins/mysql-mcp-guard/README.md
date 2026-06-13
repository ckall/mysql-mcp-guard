# MySQL MCP Guard

Guarded MySQL tools for OpenClaw.

## What It Does

MySQL MCP Guard exposes a small set of MySQL tools that read credentials from runtime environment variables and shell out to the local `mysql` client. It is designed for agent workflows where dumping a huge result set or full schema can overwhelm context.

The defaults are conservative:

- Write SQL is disabled unless `MYSQL_MCP_ALLOW_WRITE=true`.
- Only one SQL statement is accepted per call.
- `MYSQL_MCP_DEFAULT_LIMIT`, `MYSQL_MCP_MAX_LIMIT`, `MYSQL_MCP_MAX_CELL_CHARS`, and `MYSQL_MCP_MAX_OUTPUT_CHARS` are optional.
- For those limit variables, `0` or blank means unlimited.

## Tools

- `mysql_mcp_guard_query`
- `mysql_mcp_guard_list_tables`
- `mysql_mcp_guard_describe_table`
- `mysql_mcp_guard_count_estimate`

## Required Environment

Set these in the OpenClaw runtime environment or MCP/plugin wrapper:

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE
```

Optional:

```text
MYSQL_BIN=/opt/homebrew/bin/mysql
MYSQL_MCP_CONNECT_TIMEOUT=8
MYSQL_MCP_ALLOW_WRITE=false
MYSQL_MCP_DEFAULT_LIMIT=0
MYSQL_MCP_MAX_LIMIT=0
MYSQL_MCP_MAX_CELL_CHARS=0
MYSQL_MCP_MAX_OUTPUT_CHARS=0
```

Do not publish secrets in plugin metadata, docs, or examples.

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
