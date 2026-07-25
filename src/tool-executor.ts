import type { DBSQLSessionType } from './database-config.js';
import { PermissionGuard } from './permission-guard.js';
import { DbCapabilities } from './db-capabilities.js';

type TextContent = { type: 'text'; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

/**
 * Responsible for executing each MCP tool and returning the result.
 */
export class ToolExecutor {
  private readonly session: DBSQLSessionType;
  private readonly permissionGuard: PermissionGuard;
  private readonly capabilities: DbCapabilities;

  constructor(
    session: DBSQLSessionType,
    permissionGuard: PermissionGuard,
    capabilities: DbCapabilities,
  ) {
    this.session = session;
    this.permissionGuard = permissionGuard;
    this.capabilities = capabilities;
  }

  async listCatalogsAndSchemas(): Promise<ToolResult> {
    const entries: Array<{ catalog: string | null; schemas: string[] }> = [];

    if (await this.capabilities.hasCatalogs()) {
      // Unity Catalog / multi-catalog: use Databricks SQL commands
      const catOp = await this.session.executeStatement('SHOW CATALOGS', { runAsync: true });
      const catRows = (await catOp.fetchAll()) as Array<Record<string, unknown>>;
      await catOp.close();

      const catalogs = catRows.map((row) => String(Object.values(row)[0]));

      for (const catalog of catalogs) {
        const schOp = await this.session.executeStatement(
          `SHOW SCHEMAS IN \`${catalog}\``,
          { runAsync: true },
        );
        const schRows = (await schOp.fetchAll()) as Array<Record<string, unknown>>;
        await schOp.close();

        const schemas = schRows.map((row) => String(Object.values(row)[0]));
        entries.push({ catalog, schemas });
      }
    } else {
      // Fallback: try SHOW SCHEMAS (no catalog support)
      try {
        const schOp = await this.session.executeStatement('SHOW SCHEMAS', { runAsync: true });
        const schRows = (await schOp.fetchAll()) as Array<Record<string, unknown>>;
        await schOp.close();

        const schemas = schRows.map((row) => String(Object.values(row)[0]));
        entries.push({ catalog: null, schemas });
      } catch {
        entries.push({ catalog: null, schemas: [] });
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ catalogs: entries }) }],
    };
  }

  async executeQuery(query: string): Promise<ToolResult> {
    const denied = this.permissionGuard.checkOperationAllowed(query);
    if (denied) {
      return {
        content: [{ type: 'text', text: `Permission denied: ${denied}` }],
        isError: true,
      };
    }

    const op = await this.session.executeStatement(query, { runAsync: true });
    const rows = (await op.fetchAll()) as Array<Record<string, unknown>>;
    await op.close();

    // For non-SELECT statements that return no rows, report success
    const isSelect = query.trim().split(/\s+/)[0].toUpperCase() === 'SELECT';
    if (!isSelect && rows.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([{ status: 'success', rows_affected: 0 }]),
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(rows) }],
    };
  }

  async getTables(): Promise<ToolResult> {
    // Use SHOW TABLES which works on Databricks
    try {
      const op = await this.session.executeStatement('SHOW TABLES', { runAsync: true });
      const rows = (await op.fetchAll()) as Array<Record<string, unknown>>;
      await op.close();

      const tables = rows.map((row) => {
        // SHOW TABLES returns columns like tableName, database, isTemporary
        const vals = Object.values(row);
        // The table name is typically the second column (after database)
        return String(vals[1] ?? vals[0]);
      });

      return {
        content: [{ type: 'text', text: JSON.stringify({ tables }) }],
      };
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({ tables: [] }) }],
      };
    }
  }

  async getSchema(rawTableName: string): Promise<ToolResult> {
    // Parse optional catalog.schema.table or schema.table or table
    let catalog: string | null = null;
    let schema: string | null = null;
    let tableName: string;

    const parts = rawTableName.split('.');
    if (parts.length === 3) {
      catalog = parts[0];
      schema = parts[1];
      tableName = parts[2];
    } else if (parts.length === 2) {
      schema = parts[0];
      tableName = parts[1];
    } else {
      tableName = rawTableName;
    }

    const columns: Array<{
      column_name: string;
      type_name: string;
      size: number | null;
      nullable: boolean;
    }> = [];

    if (catalog && schema && (await this.capabilities.hasInformationSchema())) {
      // Fully qualified with information_schema support
      const sql =
        `SELECT column_name, data_type, character_maximum_length AS size, is_nullable` +
        ` FROM \`${catalog}\`.information_schema.columns` +
        ` WHERE table_schema = '${schema.replace(/'/g, "''")}'` +
        `   AND table_name = '${tableName.replace(/'/g, "''")}'` +
        ` ORDER BY ordinal_position`;

      const op = await this.session.executeStatement(sql, { runAsync: true });
      const rows = (await op.fetchAll()) as Array<Record<string, unknown>>;
      await op.close();

      for (const row of rows) {
        columns.push({
          column_name: String(row.column_name ?? row.COLUMN_NAME ?? ''),
          type_name: String(row.data_type ?? row.DATA_TYPE ?? ''),
          size: row.size != null ? Number(row.size) : null,
          nullable: String(row.is_nullable ?? row.IS_NULLABLE ?? '').toUpperCase() === 'YES',
        });
      }
    } else {
      // Fallback: DESCRIBE TABLE
      const fullName = [catalog, schema, tableName].filter(Boolean).join('.');
      const op = await this.session.executeStatement(`DESCRIBE TABLE ${fullName}`, {
        runAsync: true,
      });
      const rows = (await op.fetchAll()) as Array<Record<string, unknown>>;
      await op.close();

      for (const row of rows) {
        const colName = String(row.col_name ?? Object.values(row)[0] ?? '');
        // Skip partition/metadata lines
        if (colName === '' || colName.startsWith('#') || colName.startsWith('--')) continue;

        columns.push({
          column_name: colName,
          type_name: String(row.data_type ?? Object.values(row)[1] ?? ''),
          size: null,
          nullable: true, // DESCRIBE doesn't provide nullable info
        });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ table: rawTableName, columns }),
        },
      ],
    };
  }
}
