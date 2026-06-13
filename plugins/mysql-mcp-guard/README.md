# MySQL MCP Guard

Guarded MySQL tools for OpenClaw.

## What It Does

MySQL MCP Guard exposes a small set of MySQL tools that read credentials from OpenClaw plugin config, fall back to runtime environment variables, and shell out to the local `mysql` client. It is designed for agent workflows where dumping a huge result set or full schema can overwhelm context.

The defaults are conservative:

- Write SQL is disabled unless `allowWrite=true`.
- Only one SQL statement is accepted per call.
- `defaultLimit`, `maxLimit`, `maxCellChars`, and `maxOutputChars` are optional.
- For those limit fields, `0` or blank means unlimited.

## Tools

- `mysql_mcp_guard_query`
- `mysql_mcp_guard_list_tables`
- `mysql_mcp_guard_describe_table`
- `mysql_mcp_guard_count_estimate`

## Configuration

Preferred OpenClaw plugin config fields:

```json
{
  "host": "127.0.0.1",
  "port": "3306",
  "user": "readonly_user",
  "password": "...",
  "database": "app_db",
  "mysqlBin": "/opt/homebrew/bin/mysql",
  "connectTimeout": "8",
  "allowWrite": false,
  "defaultLimit": 0,
  "maxLimit": 0,
  "maxCellChars": 0,
  "maxOutputChars": 0
}
```

Environment fallback is also supported:

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

Do not publish secrets in plugin metadata, docs, examples, or screenshots.

## Build

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```
