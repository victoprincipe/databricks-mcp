#!/usr/bin/env node

/**
 * Entrypoint for the Databricks MCP Server.
 * Uses @modelcontextprotocol/sdk for the MCP protocol layer
 * and @databricks/sql for database connectivity.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DatabaseConfig } from './database-config.js';
import { PermissionGuard } from './permission-guard.js';
import { ToolExecutor } from './tool-executor.js';

export function buildListCatalogsDescription(capabilities: {
  isDatabricks: () => boolean;
}): string {
  if (capabilities.isDatabricks()) {
    return (
      'List all available catalogs and schemas in the connected Databricks database. ' +
      'IMPORTANT: Call this tool whenever the user does not specify which catalog or schema to use. ' +
      'After calling it, follow these steps strictly: ' +
      '1. Use the question tool (if available) to ask the user which CATALOG they want to use — present each catalog name as a separate option. ' +
      '2. Then use the question tool again to ask which SCHEMA within that chosen catalog — present only the schemas that belong to the chosen catalog as options. ' +
      '3. If the question tool is not available, ask both questions as plain text, one at a time, waiting for the user reply before asking the next. ' +
      'Do NOT proceed with any query or table operation until both catalog and schema are confirmed by the user.'
    );
  }
  return (
    'List all available schemas in the connected database. ' +
    'IMPORTANT: Call this tool whenever the user does not specify which schema to use. ' +
    'After calling it, ask the user which SCHEMA they want to use — present each schema name as a separate option. ' +
    'Do NOT proceed with any query or table operation until the schema is confirmed by the user.'
  );
}

export function buildExecuteQueryDescription(permissionGuard: PermissionGuard): string {
  if (permissionGuard.isAllowAll() || permissionGuard.getAllowedOperations() === null) {
    return 'Execute a SQL query against the connected Databricks database. All SQL operations are permitted.';
  }
  const ops = Array.from(permissionGuard.getAllowedOperations()!).join(', ');
  return `Execute a SQL query against the connected Databricks database. Allowed operations: ${ops}.`;
}

export function buildTableNameDescription(capabilities: {
  isDatabricks: () => boolean;
}): string {
  if (capabilities.isDatabricks()) {
    return (
      'The name of the table. Accepted formats: ' +
      '"catalog.schema.table" (fully qualified), ' +
      '"schema.table", or just "table".'
    );
  }
  return 'The name of the table. Accepted formats: "schema.table" or just "table".';
}

export function createMcpServer(
  permissionGuard: PermissionGuard,
  toolExecutor: ToolExecutor,
  capabilities: { isDatabricks: () => boolean },
): McpServer {
  const server = new McpServer({
    name: 'databricks-mcp',
    version: '1.0.0',
  });

  // list_catalogs_and_schemas
  server.tool(
    'list_catalogs_and_schemas',
    buildListCatalogsDescription(capabilities),
    {},
    async () => {
      try {
        return await toolExecutor.listCatalogsAndSchemas();
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing list_catalogs_and_schemas: ${e instanceof Error ? e.message : e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // execute_query
  server.tool(
    'execute_query',
    buildExecuteQueryDescription(permissionGuard),
    { query: z.string().describe('The SQL query to execute.') },
    async ({ query }) => {
      try {
        return await toolExecutor.executeQuery(query);
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing execute_query: ${e instanceof Error ? e.message : e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // get_tables
  server.tool(
    'get_tables',
    'Retrieve a list of all tables in the connected database.',
    {},
    async () => {
      try {
        return await toolExecutor.getTables();
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing get_tables: ${e instanceof Error ? e.message : e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // get_schema
  server.tool(
    'get_schema',
    'Retrieve the schema (columns, data types) for a specific table.',
    {
      table_name: z.string().describe(buildTableNameDescription(capabilities)),
    },
    async ({ table_name }) => {
      try {
        return await toolExecutor.getSchema(table_name);
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing get_schema: ${e instanceof Error ? e.message : e}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

export async function main(): Promise<void> {
  let dbConfig: DatabaseConfig;
  try {
    dbConfig = await DatabaseConfig.create();
  } catch (e) {
    console.error(`Failed to connect to Databricks: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const capabilities = dbConfig.getCapabilities();
  const permissionGuard = new PermissionGuard();
  const toolExecutor = new ToolExecutor(
    dbConfig.getSession(),
    permissionGuard,
    capabilities,
  );

  const server = createMcpServer(permissionGuard, toolExecutor, capabilities);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Databricks MCP server running on stdio');

  process.on('SIGINT', async () => {
    console.error('Shutting down...');
    await dbConfig.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    console.error('Shutting down...');
    await dbConfig.close();
    process.exit(0);
  });
}

// Only execute main if run directly from CLI
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  main().catch((e) => {
    console.error(`Fatal server error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
