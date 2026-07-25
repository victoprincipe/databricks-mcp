# Databricks MCP Server (`databricks-mcp`)

A standalone MCP (Model Context Protocol) server that connects to Databricks using the native `@databricks/sql` Node.js driver. Built with TypeScript and the official `@modelcontextprotocol/sdk`.

Exposes four MCP tools over `stdio`:

| Tool | Description |
|---|---|
| `list_catalogs_and_schemas` | List all available catalogs and schemas |
| `execute_query` | Execute a SQL query (SELECT only by default) |
| `get_tables` | List all tables in the connected database |
| `get_schema` | Get columns and types for a specific table |

---

## Quick Usage via `npx` (No repository clone needed)

You can run this MCP server directly using `npx` in any MCP client:

```bash
npx -y databricks-mcp
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABRICKS_HOST` | Yes | Databricks workspace hostname (e.g., `adb-123.azuredatabricks.net`) |
| `DATABRICKS_TOKEN` | Yes | Databricks Personal Access Token |
| `DATABRICKS_HTTP_PATH` | Yes | SQL Warehouse HTTP path (e.g., `/sql/1.0/warehouses/abc123def456`) |
| `ALLOWED_OPERATIONS` | No | Comma-separated list of permitted SQL operations. Default: `SELECT`. Example: `SELECT,INSERT,UPDATE` |
| `ALLOW_ALL` | No | Set to `true` to allow all SQL operations (disables `ALLOWED_OPERATIONS`). Useful for dev/admin mode. |

---

## Client Integration Guide

### 1. Antigravity / Gemini IDE / VS Code MCP Extension

Add the following to your MCP settings file (`~/.gemini/antigravity-ide/mcp.json` or VS Code MCP configuration):

```json
{
  "mcpServers": {
    "databricks-db": {
      "command": "npx",
      "args": ["-y", "databricks-mcp"],
      "env": {
        "DATABRICKS_HOST": "adb-123456789.12.azuredatabricks.net",
        "DATABRICKS_TOKEN": "dapi...",
        "DATABRICKS_HTTP_PATH": "/sql/1.0/warehouses/abc123def456",
        "ALLOWED_OPERATIONS": "SELECT"
      }
    }
  }
}
```

### 2. Claude Code

```json
{
  "mcpServers": {
    "databricks-db": {
      "command": "npx",
      "args": ["-y", "databricks-mcp"],
      "env": {
        "DATABRICKS_HOST": "adb-123456789.12.azuredatabricks.net",
        "DATABRICKS_TOKEN": "dapi...",
        "DATABRICKS_HTTP_PATH": "/sql/1.0/warehouses/abc123def456"
      }
    }
  }
}
```

### 3. OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "databricks-db": {
      "type": "local",
      "command": ["npx", "-y", "databricks-mcp"],
      "environment": {
        "DATABRICKS_HOST": "adb-123456789.12.azuredatabricks.net",
        "DATABRICKS_TOKEN": "dapi...",
        "DATABRICKS_HTTP_PATH": "/sql/1.0/warehouses/abc123def456",
        "ALLOWED_OPERATIONS": "SELECT"
      },
      "enabled": true
    }
  }
}
```

### 4. Cursor / Windsurf / Zed

Add to `.cursor/mcp.json` or your editor's MCP configuration:

```json
{
  "mcpServers": {
    "databricks-db": {
      "command": "npx",
      "args": ["-y", "databricks-mcp"],
      "env": {
        "DATABRICKS_HOST": "adb-123456789.12.azuredatabricks.net",
        "DATABRICKS_TOKEN": "dapi...",
        "DATABRICKS_HTTP_PATH": "/sql/1.0/warehouses/abc123def456"
      }
    }
  }
}
```

---

## Local Development

If developing locally or running from source:

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Run locally
DATABRICKS_HOST="adb-123.azuredatabricks.net" \
DATABRICKS_TOKEN="dapi..." \
DATABRICKS_HTTP_PATH="/sql/1.0/warehouses/abc123" \
  npm start
```

---

## Security & Permission Guard

By default, `execute_query` only permits `SELECT` statements (read-only mode). 

You can configure allowed SQL operations via `ALLOWED_OPERATIONS` or allow all operations via `ALLOW_ALL`:

```bash
# Read-only (default)
ALLOWED_OPERATIONS=SELECT

# Read-write
ALLOWED_OPERATIONS=SELECT,INSERT,UPDATE,DELETE

# Stored procedures & DML
ALLOWED_OPERATIONS=SELECT,INSERT,UPDATE,DELETE,MERGE,CALL

# Unrestricted admin mode
ALLOW_ALL=true
```

Queries starting with a disallowed keyword are intercepted and blocked before reaching Databricks.

---

## Running Unit Tests

```bash
# Run all unit tests (61 test cases across 5 suites)
npm test

# Run tests with coverage report
npm run test:coverage
```

---

## License

[MIT](LICENSE) © Victo Principe
