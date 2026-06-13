import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const execFileAsync = promisify(execFile);

const READ_PREFIX_RE = /^\s*(select|show|describe|desc|explain|with)\b/is;
const WRITE_PREFIX_RE =
  /^\s*(insert|update|delete|replace|alter|drop|create|truncate|rename|grant|revoke|set)\b/is;
const LIMIT_RE = /\blimit\s+\d+(\s*,\s*\d+|\s+offset\s+\d+)?\s*;?\s*$/is;
const IDENTIFIER_RE = /^[A-Za-z0-9_.$-]+$/;

const ConfigSchema = Type.Object({
  mysqlBin: Type.Optional(Type.String({ description: "Path to the mysql CLI binary." })),
  host: Type.Optional(Type.String({ description: "MySQL host." })),
  port: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: "MySQL port." })),
  user: Type.Optional(Type.String({ description: "MySQL user." })),
  password: Type.Optional(Type.String({ description: "MySQL password." })),
  database: Type.Optional(Type.String({ description: "MySQL database/schema." })),
  connectTimeout: Type.Optional(
    Type.Union([Type.String(), Type.Number()], { description: "mysql CLI connect timeout in seconds." }),
  ),
  allowWrite: Type.Optional(Type.Boolean({ description: "Allow write SQL. Defaults to false." })),
  defaultLimit: Type.Optional(Type.Number({ description: "Default row limit. 0 or blank means unlimited." })),
  maxLimit: Type.Optional(Type.Number({ description: "Maximum row limit. 0 or blank means unlimited." })),
  maxCellChars: Type.Optional(Type.Number({ description: "Maximum cell length. 0 or blank means unlimited." })),
  maxOutputChars: Type.Optional(Type.Number({ description: "Maximum JSON output length. 0 or blank means unlimited." })),
});

type MysqlPluginConfig = {
  mysqlBin?: string;
  host?: string;
  port?: string | number;
  user?: string;
  password?: string;
  database?: string;
  connectTimeout?: string | number;
  allowWrite?: boolean;
  defaultLimit?: number;
  maxLimit?: number;
  maxCellChars?: number;
  maxOutputChars?: number;
};

type QueryPayload = {
  database: string;
  executed_sql: string;
  limit: number | "unlimited";
  max_cell_chars: number | null;
  result: {
    columns: string[];
    rows: Record<string, string>[];
    row_count: number;
    truncated: boolean;
  };
};

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function configString(config: MysqlPluginConfig, field: keyof MysqlPluginConfig, envName: string, fallback = ""): string {
  const configValue = config[field];
  if (configValue !== undefined && configValue !== null && String(configValue).trim() !== "") {
    return String(configValue);
  }
  return env(envName, fallback);
}

function optionalPositiveInt(config: MysqlPluginConfig, field: keyof MysqlPluginConfig, envName: string): number | null {
  const configValue = config[field];
  const raw =
    configValue !== undefined && configValue !== null && String(configValue).trim() !== ""
      ? String(configValue).trim()
      : env(envName).trim();
  if (raw === "") return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value)) throw new Error(`${String(field)} must be an integer`);
  return value > 0 ? value : null;
}

function mysqlConfig(config: MysqlPluginConfig = {}) {
  return {
    bin: configString(config, "mysqlBin", "MYSQL_BIN", "/opt/homebrew/bin/mysql"),
    host: configString(config, "host", "MYSQL_HOST", "127.0.0.1"),
    port: configString(config, "port", "MYSQL_PORT", "3306"),
    user: configString(config, "user", "MYSQL_USER"),
    password: configString(config, "password", "MYSQL_PASSWORD"),
    database: configString(config, "database", "MYSQL_DATABASE"),
    connectTimeout: configString(config, "connectTimeout", "MYSQL_MCP_CONNECT_TIMEOUT", "8"),
    allowWrite: config.allowWrite ?? env("MYSQL_MCP_ALLOW_WRITE", "false").toLowerCase() === "true",
    defaultLimit: optionalPositiveInt(config, "defaultLimit", "MYSQL_MCP_DEFAULT_LIMIT"),
    maxLimit: optionalPositiveInt(config, "maxLimit", "MYSQL_MCP_MAX_LIMIT"),
    maxCellChars: optionalPositiveInt(config, "maxCellChars", "MYSQL_MCP_MAX_CELL_CHARS"),
    maxOutputChars: optionalPositiveInt(config, "maxOutputChars", "MYSQL_MCP_MAX_OUTPUT_CHARS"),
  };
}

function cleanSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("sql is required");
  if (trimmed.split(";").length - 1 > 1 || (trimmed.includes(";") && !trimmed.endsWith(";"))) {
    throw new Error("Only one SQL statement is allowed");
  }
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;
}

function resolveLimit(limit: number | undefined, config: MysqlPluginConfig): number | null {
  const cfg = mysqlConfig(config);
  const requested = limit && limit > 0 ? limit : cfg.defaultLimit;
  if (requested == null) return null;
  return cfg.maxLimit == null ? requested : Math.min(requested, cfg.maxLimit);
}

function ensureSafeSql(sql: string, limit: number | null, config: MysqlPluginConfig): string {
  const cfg = mysqlConfig(config);
  const cleaned = cleanSql(sql);
  if (WRITE_PREFIX_RE.test(cleaned) && !cfg.allowWrite) {
    throw new Error("Write SQL is disabled. Set allowWrite=true only for a controlled server.");
  }
  if (!cfg.allowWrite && !READ_PREFIX_RE.test(cleaned)) {
    throw new Error("Only SELECT/SHOW/DESCRIBE/EXPLAIN/WITH statements are allowed");
  }
  if (
    limit != null &&
    READ_PREFIX_RE.test(cleaned) &&
    cleaned.toLowerCase().trimStart().match(/^(select|with)\b/) &&
    !LIMIT_RE.test(cleaned)
  ) {
    return `${cleaned} LIMIT ${limit}`;
  }
  return cleaned;
}

async function runMysql(sql: string, config: MysqlPluginConfig): Promise<string> {
  const cfg = mysqlConfig(config);
  if (!cfg.database) throw new Error("database is required");
  if (!cfg.user) throw new Error("user is required");

  const args = [
    "--host",
    cfg.host,
    "--port",
    cfg.port,
    "--user",
    cfg.user,
    "--database",
    cfg.database,
    "--default-character-set=utf8mb4",
    "--connect-timeout",
    cfg.connectTimeout,
    "--batch",
    "--raw",
    "--execute",
    sql,
  ];

  const childEnv = { ...process.env };
  if (cfg.password) childEnv.MYSQL_PWD = cfg.password;

  try {
    const result = await execFileAsync(cfg.bin, args, {
      env: childEnv,
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error((err.stderr || err.stdout || err.message || String(error)).trim().slice(0, 2000));
  }
}

function truncateValue(value: string, maxCellChars: number | null): string {
  if (maxCellChars == null) return value;
  if (value.length <= maxCellChars) return value;
  return `${value.slice(0, maxCellChars)}...<truncated ${value.length - maxCellChars} chars>`;
}

function parseTsv(stdout: string, limit: number | null, maxCellChars: number | null): QueryPayload["result"] {
  if (!stdout.trim()) return { columns: [], rows: [], row_count: 0, truncated: false };
  const lines = stdout.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return { columns: [], rows: [], row_count: 0, truncated: false };

  const columns = lines[0].split("\t");
  const body = limit == null ? lines.slice(1) : lines.slice(1, limit + 1);
  const rows = body.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      columns.map((column, index) => [column, truncateValue(values[index] ?? "", maxCellChars)]),
    );
  });
  return {
    columns,
    rows,
    row_count: rows.length,
    truncated: limit == null ? false : lines.length - 1 > rows.length,
  };
}

function boundedJson(payload: unknown, config: MysqlPluginConfig): string {
  const maxOutputChars = mysqlConfig(config).maxOutputChars;
  const text = JSON.stringify(payload, null, 2);
  if (maxOutputChars == null || text.length <= maxOutputChars) return text;
  const marker = `\n...<output truncated at ${maxOutputChars} chars>`;
  return `${text.slice(0, Math.max(0, maxOutputChars - marker.length))}${marker}`;
}

async function queryLimited(sql: string, limit = 0, config: MysqlPluginConfig): Promise<QueryPayload> {
  const cfg = mysqlConfig(config);
  const safeLimit = resolveLimit(limit, config);
  const safeSql = ensureSafeSql(sql, safeLimit, config);
  const stdout = await runMysql(safeSql, config);
  return {
    database: cfg.database,
    executed_sql: safeSql,
    limit: safeLimit == null ? "unlimited" : safeLimit,
    max_cell_chars: cfg.maxCellChars,
    result: parseTsv(stdout, safeLimit, cfg.maxCellChars),
  };
}

function assertTableName(table: string): string {
  if (!IDENTIFIER_RE.test(table)) throw new Error("Invalid table name");
  return table.replace(/`/g, "");
}

export default defineToolPlugin({
  id: "mysql-mcp-guard",
  name: "MySQL MCP Guard",
  description: "Guarded MySQL tools with read-only defaults and optional output limits.",
  configSchema: ConfigSchema,
  tools: (tool) => [
    tool({
      name: "mysql_mcp_guard_query",
      description: "Run one guarded MySQL statement. Limit 0 means unlimited unless defaultLimit is set.",
      parameters: Type.Object({
        sql: Type.String({ description: "One SQL statement." }),
        limit: Type.Optional(Type.Number({ description: "Maximum rows. 0 means unlimited/default.", default: 0 })),
      }),
      execute: async ({ sql, limit }, config) => boundedJson(await queryLimited(sql, limit ?? 0, config), config),
    }),
    tool({
      name: "mysql_mcp_guard_list_tables",
      description: "List tables in the configured database.",
      parameters: Type.Object({
        pattern: Type.Optional(Type.String({ description: "Optional table-name substring filter.", default: "" })),
        limit: Type.Optional(Type.Number({ description: "Maximum tables. 0 means unlimited/default.", default: 0 })),
      }),
      execute: async ({ pattern = "", limit = 0 }, config) => {
        const safeLimit = resolveLimit(limit, config);
        const escaped = pattern
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "''")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        const where = pattern.trim() ? `AND table_name LIKE '%${escaped}%' ESCAPE '\\\\'` : "";
        const sql = [
          "SELECT table_name, table_rows, table_comment",
          "FROM information_schema.tables",
          `WHERE table_schema = DATABASE() ${where}`,
          "ORDER BY table_name",
          safeLimit == null ? "" : `LIMIT ${safeLimit}`,
        ].join(" ");
        return boundedJson(await queryLimited(sql, safeLimit ?? 0, config), config);
      },
    }),
    tool({
      name: "mysql_mcp_guard_describe_table",
      description: "Return compact columns and optional indexes for one table.",
      parameters: Type.Object({
        table: Type.String({ description: "Table name." }),
        include_indexes: Type.Optional(Type.Boolean({ description: "Include index summary.", default: true })),
      }),
      execute: async ({ table, include_indexes = true }, config) => {
        const tableName = assertTableName(table);
        const columns = await queryLimited(
          [
            "SELECT column_name, column_type, is_nullable, column_key, column_default, column_comment",
            "FROM information_schema.columns",
            `WHERE table_schema = DATABASE() AND table_name = '${tableName}'`,
            "ORDER BY ordinal_position",
          ].join(" "),
          0,
          config,
        );
        const payload: Record<string, unknown> = {
          database: mysqlConfig(config).database,
          table: tableName,
          columns: columns.result.rows,
        };
        if (include_indexes) {
          const indexes = await queryLimited(
            [
              "SELECT index_name, non_unique, seq_in_index, column_name, cardinality",
              "FROM information_schema.statistics",
              `WHERE table_schema = DATABASE() AND table_name = '${tableName}'`,
              "ORDER BY index_name, seq_in_index",
            ].join(" "),
            0,
            config,
          );
          payload.indexes = indexes.result.rows;
        }
        return boundedJson(payload, config);
      },
    }),
    tool({
      name: "mysql_mcp_guard_count_estimate",
      description: "Return information_schema estimated rows and size for one table.",
      parameters: Type.Object({
        table: Type.String({ description: "Table name." }),
      }),
      execute: async ({ table }, config) => {
        const tableName = assertTableName(table);
        return boundedJson(
          await queryLimited(
            [
              "SELECT table_name, table_rows, data_length, index_length, table_comment",
              "FROM information_schema.tables",
              `WHERE table_schema = DATABASE() AND table_name = '${tableName}'`,
              "LIMIT 1",
            ].join(" "),
            1,
            config,
          ),
          config,
        );
      },
    }),
  ],
});
