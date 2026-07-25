import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbCapabilities } from '../src/db-capabilities.js';

/**
 * Unit tests for DbCapabilities.
 * Uses mock sessions to test lazy detection logic.
 */

// ── mock session factory ───────────────────────────────────────────────────

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

// ── tests ──────────────────────────────────────────────────────────────────

describe('DbCapabilities', () => {
  let session: MockSession;

  beforeEach(() => {
    session = createMockSession();
  });

  // ── isDatabricks ────────────────────────────────────────────────────────

  describe('isDatabricks', () => {
    it('spark', () => {
      const caps = new DbCapabilities(session as any, 'SparkSQL');
      expect(caps.isDatabricks()).toBe(true);
    });

    it('databricks', () => {
      const caps = new DbCapabilities(session as any, 'Databricks');
      expect(caps.isDatabricks()).toBe(true);
    });

    it('caseInsensitive', () => {
      const caps = new DbCapabilities(session as any, 'SPARKSQL 3.3');
      expect(caps.isDatabricks()).toBe(true);
    });

    it('postgres', () => {
      const caps = new DbCapabilities(session as any, 'PostgreSQL');
      expect(caps.isDatabricks()).toBe(false);
    });

    it('nullProductName', () => {
      const caps = new DbCapabilities(session as any, null);
      expect(caps.isDatabricks()).toBe(false);
    });
  });

  // ── hasCatalogs ─────────────────────────────────────────────────────────

  describe('hasCatalogs', () => {
    it('true when SHOW CATALOGS succeeds', async () => {
      const op = createMockOp([{ catalog: 'my_catalog' }]);
      session.executeStatement.mockResolvedValueOnce(op);

      const caps = new DbCapabilities(session as any, 'SparkSQL');
      expect(await caps.hasCatalogs()).toBe(true);
    });

    it('false when SHOW CATALOGS fails', async () => {
      session.executeStatement.mockRejectedValueOnce(new Error('not supported'));

      const caps = new DbCapabilities(session as any, 'PostgreSQL');
      expect(await caps.hasCatalogs()).toBe(false);
    });

    it('cached — executeStatement called once', async () => {
      const op = createMockOp([{ catalog: 'cat' }]);
      session.executeStatement.mockResolvedValueOnce(op);

      const caps = new DbCapabilities(session as any, 'SparkSQL');
      await caps.hasCatalogs();
      await caps.hasCatalogs(); // second call — must use cache

      expect(session.executeStatement).toHaveBeenCalledTimes(1);
    });
  });

  // ── hasInformationSchema (hasCatalogs=true branch) ──────────────────────

  describe('hasInformationSchema with catalogs', () => {
    it('true when info_schema probe succeeds', async () => {
      const catOp = createMockOp([{ catalog: 'my_catalog' }]);
      const infoOp = createMockOp([{ one: 1 }]);

      session.executeStatement
        .mockResolvedValueOnce(catOp) // SHOW CATALOGS
        .mockResolvedValueOnce(infoOp); // info_schema probe

      const caps = new DbCapabilities(session as any, 'SparkSQL');
      expect(await caps.hasInformationSchema()).toBe(true);
    });

    it('false when info_schema probe fails', async () => {
      const catOp = createMockOp([{ catalog: 'my_catalog' }]);

      session.executeStatement
        .mockResolvedValueOnce(catOp) // SHOW CATALOGS
        .mockRejectedValueOnce(new Error('no info_schema')); // info_schema probe

      const caps = new DbCapabilities(session as any, 'SparkSQL');
      expect(await caps.hasInformationSchema()).toBe(false);
    });

    it('false when SHOW CATALOGS returns no rows', async () => {
      const catOp = createMockOp([]); // no catalogs
      session.executeStatement.mockResolvedValueOnce(catOp);

      const caps = new DbCapabilities(session as any, 'SparkSQL');
      // hasCatalogs is true (SHOW CATALOGS succeeded) but firstCatalog is null
      expect(await caps.hasInformationSchema()).toBe(false);
    });
  });

  // ── hasInformationSchema (hasCatalogs=false branch) ────────────────────

  describe('hasInformationSchema without catalogs', () => {
    it('true when plain info_schema probe succeeds', async () => {
      const infoOp = createMockOp([{ one: 1 }]);

      session.executeStatement
        .mockRejectedValueOnce(new Error('no catalogs')) // SHOW CATALOGS fails
        .mockResolvedValueOnce(infoOp); // plain info_schema

      const caps = new DbCapabilities(session as any, 'PostgreSQL');
      expect(await caps.hasInformationSchema()).toBe(true);
    });

    it('false when plain info_schema probe fails', async () => {
      session.executeStatement
        .mockRejectedValueOnce(new Error('no catalogs')) // SHOW CATALOGS fails
        .mockRejectedValueOnce(new Error('no info_schema')); // plain info_schema fails

      const caps = new DbCapabilities(session as any, 'PostgreSQL');
      expect(await caps.hasInformationSchema()).toBe(false);
    });

    it('cached — detection runs once', async () => {
      const catOp = createMockOp([{ catalog: 'cat' }]);
      const infoOp = createMockOp([{ one: 1 }]);

      session.executeStatement
        .mockResolvedValueOnce(catOp) // SHOW CATALOGS
        .mockResolvedValueOnce(infoOp); // info_schema

      const caps = new DbCapabilities(session as any, 'SparkSQL');
      await caps.hasInformationSchema();
      await caps.hasInformationSchema(); // second — must use cache

      // 2 calls total: SHOW CATALOGS + info_schema probe
      expect(session.executeStatement).toHaveBeenCalledTimes(2);
    });
  });

  // ── describe ────────────────────────────────────────────────────────────

  describe('describe', () => {
    it('before detection shows not detected', () => {
      const caps = new DbCapabilities(session as any, 'SparkSQL');
      const d = caps.describe();
      expect(d).toContain('not yet detected');
    });

    it('after hasCatalogs shows value', async () => {
      session.executeStatement.mockRejectedValueOnce(new Error('no'));

      const caps = new DbCapabilities(session as any, 'PostgreSQL');
      await caps.hasCatalogs();
      const d = caps.describe();
      expect(d).toContain('hasCatalogs=false');
      expect(d).toContain('hasInformationSchema=<not yet detected>');
    });

    it('after hasInformationSchema shows all detected values', async () => {
      const catOp = createMockOp([{ catalog: 'my_cat' }]);
      const infoOp = createMockOp([{ one: 1 }]);

      session.executeStatement
        .mockResolvedValueOnce(catOp)
        .mockResolvedValueOnce(infoOp);

      const caps = new DbCapabilities(session as any, 'SparkSQL');
      await caps.hasInformationSchema();
      const d = caps.describe();
      expect(d).toContain('hasCatalogs=true');
      expect(d).toContain('hasInformationSchema=true');
    });
  });
});

