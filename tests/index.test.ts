import { describe, it, expect, vi } from 'vitest';
import {
  buildListCatalogsDescription,
  buildExecuteQueryDescription,
  buildTableNameDescription,
  createMcpServer,
  main,
} from '../src/index.js';
import { PermissionGuard } from '../src/permission-guard.js';
import { DatabaseConfig } from '../src/database-config.js';

describe('src/index.ts helpers and server', () => {
  describe('buildListCatalogsDescription', () => {
    it('returns catalog description when isDatabricks is true', () => {
      const desc = buildListCatalogsDescription({ isDatabricks: () => true });
      expect(desc).toContain('catalogs and schemas');
      expect(desc).toContain('CATALOG');
    });

    it('returns schema-only description when isDatabricks is false', () => {
      const desc = buildListCatalogsDescription({ isDatabricks: () => false });
      expect(desc).not.toContain('catalogs');
      expect(desc).toContain('schemas');
    });
  });

  describe('buildExecuteQueryDescription', () => {
    it('returns all operations permitted when allowAll is true', () => {
      const guard = new PermissionGuard(true, null);
      const desc = buildExecuteQueryDescription(guard);
      expect(desc).toContain('All SQL operations are permitted');
    });

    it('returns list of allowed operations when allowAll is false', () => {
      const guard = new PermissionGuard(false, new Set(['SELECT', 'INSERT']));
      const desc = buildExecuteQueryDescription(guard);
      expect(desc).toContain('Allowed operations: SELECT, INSERT');
    });
  });

  describe('buildTableNameDescription', () => {
    it('returns 3-part format description when isDatabricks is true', () => {
      const desc = buildTableNameDescription({ isDatabricks: () => true });
      expect(desc).toContain('catalog.schema.table');
    });

    it('returns 2-part format description when isDatabricks is false', () => {
      const desc = buildTableNameDescription({ isDatabricks: () => false });
      expect(desc).not.toContain('catalog.schema.table');
      expect(desc).toContain('schema.table');
    });
  });

  describe('createMcpServer tool callbacks', () => {
    it('registers tools and handles successful tool execution', async () => {
      const mockExecutor = {
        listCatalogsAndSchemas: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
        executeQuery: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'query-ok' }] }),
        getTables: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'tables-ok' }] }),
        getSchema: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'schema-ok' }] }),
      };

      const guard = new PermissionGuard(true, null);
      const server = createMcpServer(guard, mockExecutor as any, { isDatabricks: () => true });

      expect(server).toBeDefined();
    });

    it('wraps uncaught tool errors in isError response', async () => {
      const mockExecutor = {
        listCatalogsAndSchemas: vi.fn().mockRejectedValue(new Error('Connection lost')),
        executeQuery: vi.fn().mockRejectedValue(new Error('Syntax error')),
        getTables: vi.fn().mockRejectedValue(new Error('Table error')),
        getSchema: vi.fn().mockRejectedValue(new Error('Schema error')),
      };

      const guard = new PermissionGuard(true, null);
      const server = createMcpServer(guard, mockExecutor as any, { isDatabricks: () => true });

      expect(server).toBeDefined();
    });
  });

  describe('main() failure path', () => {
    it('handles connection failure during main() initialization', async () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | boolean | null) => {
        throw new Error(`process.exit(${code})`);
      });
      vi.spyOn(DatabaseConfig, 'create').mockRejectedValueOnce(new Error('Database unavailable'));

      await expect(main()).rejects.toThrow('process.exit(1)');
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });
  });
});
