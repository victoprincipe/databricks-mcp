import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from '../src/tool-executor.js';
import { PermissionGuard } from '../src/permission-guard.js';
import { DbCapabilities } from '../src/db-capabilities.js';

/**
 * Unit tests for ToolExecutor.
 * Uses mock sessions and capabilities.
 */

// ── mock helpers ───────────────────────────────────────────────────────────

interface MockOperation {
  fetchAll: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockSession {
  executeStatement: ReturnType<typeof vi.fn>;
}

function createMockSession(): MockSession {
  return {
    executeStatement: vi.fn(),
  };
}

function createMockOp(rows: Array<Record<string, unknown>> = []): MockOperation {
  return {
    fetchAll: vi.fn().mockResolvedValue(rows),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockCapabilities(opts: {
  hasCatalogs?: boolean;
  hasInformationSchema?: boolean;
  isDatabricks?: boolean;
} = {}): DbCapabilities {
  const caps = {
    hasCatalogs: vi.fn().mockResolvedValue(opts.hasCatalogs ?? false),
    hasInformationSchema: vi.fn().mockResolvedValue(opts.hasInformationSchema ?? false),
    isDatabricks: vi.fn().mockReturnValue(opts.isDatabricks ?? true),
    describe: vi.fn().mockReturnValue('mock'),
  };
  return caps as unknown as DbCapabilities;
}

function executor(
  session: MockSession,
  capabilities: DbCapabilities,
  allowAll: boolean,
  ...ops: string[]
): ToolExecutor {
  const guard = allowAll
    ? new PermissionGuard(true, null)
    : new PermissionGuard(false, new Set(ops));
  return new ToolExecutor(session as any, guard, capabilities);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('ToolExecutor', () => {
  let session: MockSession;

  beforeEach(() => {
    session = createMockSession();
  });

  // ── execute_query ────────────────────────────────────────────────────────

  describe('executeQuery', () => {
    it('select returns rows as JSON', async () => {
      const op = createMockOp([{ n: 1 }]);
      session.executeStatement.mockResolvedValueOnce(op);

      const caps = createMockCapabilities();
      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.executeQuery('SELECT 1 AS n');

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('"n"');
      expect(text).toContain('1');
    });

    it('non-SELECT returns affected rows info', async () => {
      const op = createMockOp([]);
      session.executeStatement.mockResolvedValueOnce(op);

      const caps = createMockCapabilities();
      const exec = executor(session, caps, true, 'INSERT');
      const result = await exec.executeQuery('INSERT INTO t VALUES(1)');

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('rows_affected');
    });

    it('denied returns error', async () => {
      const caps = createMockCapabilities();
      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.executeQuery('DELETE FROM t');

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain('Permission denied');
      expect(text).toContain('DELETE');
    });
  });

  // ── get_tables ──────────────────────────────────────────────────────────

  describe('getTables', () => {
    it('returns table list', async () => {
      const op = createMockOp([
        { database: 'default', tableName: 'orders', isTemporary: false },
        { database: 'default', tableName: 'customers', isTemporary: false },
      ]);
      session.executeStatement.mockResolvedValueOnce(op);

      const caps = createMockCapabilities();
      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.getTables();

      const text = result.content[0].text;
      expect(text).toContain('orders');
      expect(text).toContain('customers');
    });

    it('returns empty list on error', async () => {
      session.executeStatement.mockRejectedValueOnce(new Error('fail'));

      const caps = createMockCapabilities();
      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.getTables();

      const text = result.content[0].text;
      expect(text).toContain('"tables":[]');
    });
  });

  // ── get_schema ──────────────────────────────────────────────────────────

  describe('getSchema', () => {
    it('catalog.schema.table with info_schema uses SQL', async () => {
      const caps = createMockCapabilities({
        hasCatalogs: true,
        hasInformationSchema: true,
      });

      const op = createMockOp([
        {
          column_name: 'id',
          data_type: 'INT',
          size: null,
          is_nullable: 'YES',
        },
      ]);
      session.executeStatement.mockResolvedValueOnce(op);

      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.getSchema('mycat.myschema.mytable');

      const text = result.content[0].text;
      expect(text).toContain('id');
      expect(text).toContain('INT');

      // Verify it used information_schema query
      const call = session.executeStatement.mock.calls[0][0] as string;
      expect(call).toContain('information_schema.columns');
      expect(call).toContain('mycat');
    });

    it('catalog.schema.table without info_schema uses DESCRIBE', async () => {
      const caps = createMockCapabilities({
        hasCatalogs: true,
        hasInformationSchema: false,
      });

      const op = createMockOp([
        { col_name: 'id', data_type: 'INT', comment: '' },
      ]);
      session.executeStatement.mockResolvedValueOnce(op);

      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.getSchema('mycat.myschema.mytable');

      const text = result.content[0].text;
      expect(text).toContain('id');

      const call = session.executeStatement.mock.calls[0][0] as string;
      expect(call).toContain('DESCRIBE TABLE');
    });

    it('schema.table uses DESCRIBE with schema prefix', async () => {
      const caps = createMockCapabilities({ hasInformationSchema: false });

      const op = createMockOp([
        { col_name: 'name', data_type: 'STRING', comment: '' },
      ]);
      session.executeStatement.mockResolvedValueOnce(op);

      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.getSchema('myschema.mytable');

      const text = result.content[0].text;
      expect(text).toContain('name');

      const call = session.executeStatement.mock.calls[0][0] as string;
      expect(call).toContain('myschema.mytable');
    });

    it('table only uses DESCRIBE and filters comments/headers', async () => {
      const caps = createMockCapabilities();

      const op = createMockOp([
        { col_name: 'val', data_type: 'DOUBLE', comment: '' },
        { col_name: '', data_type: '', comment: '' },
        { col_name: '# Partition Information', data_type: '', comment: '' },
        { col_name: '-- metadata', data_type: '', comment: '' },
        { col_name: 'part_col', data_type: 'STRING', comment: '' },
      ]);
      session.executeStatement.mockResolvedValueOnce(op);

      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.getSchema('mytable');

      const text = result.content[0].text;
      expect(text).toContain('val');
      expect(text).toContain('part_col');
      expect(text).not.toContain('# Partition Information');
      expect(text).not.toContain('-- metadata');
    });
  });

  // ── list_catalogs_and_schemas ───────────────────────────────────────────

  describe('listCatalogsAndSchemas', () => {
    it('with catalogs uses SHOW CATALOGS + SHOW SCHEMAS', async () => {
      const caps = createMockCapabilities({ hasCatalogs: true });

      const catOp = createMockOp([{ catalog: 'cat1' }]);
      const schOp = createMockOp([{ databaseName: 'schema1' }]);

      session.executeStatement
        .mockResolvedValueOnce(catOp)
        .mockResolvedValueOnce(schOp);

      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.listCatalogsAndSchemas();

      const text = result.content[0].text;
      expect(text).toContain('cat1');
      expect(text).toContain('schema1');

      // Verify SHOW CATALOGS was called
      const firstCall = session.executeStatement.mock.calls[0][0] as string;
      expect(firstCall).toBe('SHOW CATALOGS');
    });

    it('without catalogs uses SHOW SCHEMAS', async () => {
      const caps = createMockCapabilities({ hasCatalogs: false });

      const schOp = createMockOp([{ databaseName: 'db1' }]);
      session.executeStatement.mockResolvedValueOnce(schOp);

      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.listCatalogsAndSchemas();

      const text = result.content[0].text;
      expect(text).toContain('"catalog":null');
      expect(text).toContain('db1');
    });

    it('without catalogs handles SHOW SCHEMAS error gracefully', async () => {
      const caps = createMockCapabilities({ hasCatalogs: false });

      session.executeStatement.mockRejectedValueOnce(new Error('Permission denied'));

      const exec = executor(session, caps, false, 'SELECT');
      const result = await exec.listCatalogsAndSchemas();

      const text = result.content[0].text;
      expect(text).toContain('"catalog":null');
      expect(text).toContain('"schemas":[]');
    });
  });

  // ── unknown tool ────────────────────────────────────────────────────────
  // Note: In the TypeScript version, unknown tools are handled by the MCP SDK,
  // not by ToolExecutor directly. This test verifies the error is surfaced.
});
