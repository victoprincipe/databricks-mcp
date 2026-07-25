import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionGuard } from '../src/permission-guard.js';

/**
 * Unit tests for PermissionGuard.
 */

function guardWith(...ops: string[]): PermissionGuard {
  return new PermissionGuard(false, new Set(ops));
}

function guardAllowAll(): PermissionGuard {
  return new PermissionGuard(true, null);
}

describe('PermissionGuard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allowSelect_accepted', () => {
    const g = guardWith('SELECT');
    expect(g.checkOperationAllowed('SELECT * FROM my_table')).toBeNull();
  });

  it('allowSelect_caseInsensitive', () => {
    const g = guardWith('SELECT');
    expect(g.checkOperationAllowed('select id from users')).toBeNull();
  });

  it('denyDelete', () => {
    const g = guardWith('SELECT');
    const err = g.checkOperationAllowed('DELETE FROM my_table WHERE 1=1');
    expect(err).not.toBeNull();
    expect(err).toContain('DELETE');
    expect(err).toContain('SELECT');
  });

  it('denyInsert', () => {
    const g = guardWith('SELECT');
    expect(g.checkOperationAllowed('INSERT INTO t VALUES (1)')).not.toBeNull();
  });

  it('allowMultipleOps_selectAllowed', () => {
    const g = guardWith('SELECT', 'INSERT');
    expect(g.checkOperationAllowed('SELECT 1')).toBeNull();
  });

  it('allowMultipleOps_insertAllowed', () => {
    const g = guardWith('SELECT', 'INSERT');
    expect(g.checkOperationAllowed('INSERT INTO t VALUES (1)')).toBeNull();
  });

  it('allowMultipleOps_deleteStillDenied', () => {
    const g = guardWith('SELECT', 'INSERT');
    expect(g.checkOperationAllowed('DELETE FROM t')).not.toBeNull();
  });

  it('allowAll_anyOperationAccepted', () => {
    const g = guardAllowAll();
    expect(g.checkOperationAllowed('DELETE FROM t')).toBeNull();
    expect(g.checkOperationAllowed('DROP TABLE t')).toBeNull();
    expect(g.checkOperationAllowed('TRUNCATE t')).toBeNull();
  });

  it('stripSingleLineComment_beforeCheck', () => {
    const g = guardWith('SELECT');
    expect(g.checkOperationAllowed('-- DELETE FROM t\nSELECT 1')).toBeNull();
  });

  it('stripBlockComment_beforeCheck', () => {
    const g = guardWith('SELECT');
    expect(g.checkOperationAllowed('/* DELETE */ SELECT 1')).toBeNull();
  });

  it('emptyQuery_denied', () => {
    const g = guardWith('SELECT');
    const err = g.checkOperationAllowed('   ');
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toContain('empty');
  });

  it('isAllowAll_true', () => {
    expect(guardAllowAll().isAllowAll()).toBe(true);
  });

  it('isAllowAll_false', () => {
    expect(guardWith('SELECT').isAllowAll()).toBe(false);
  });

  it('getAllowedOperations_notNullWhenRestricted', () => {
    expect(guardWith('SELECT').getAllowedOperations()).not.toBeNull();
  });

  it('getAllowedOperations_nullWhenAllowAll', () => {
    expect(guardAllowAll().getAllowedOperations()).toBeNull();
  });

  // ── env-var constructor tests ───────────────────────────────────────────

  describe('env var constructor', () => {
    it('reads ALLOW_ALL=true from env', () => {
      process.env.ALLOW_ALL = 'true';
      const g = new PermissionGuard();
      expect(g.isAllowAll()).toBe(true);
      expect(g.getAllowedOperations()).toBeNull();
      expect(g.checkOperationAllowed('DELETE FROM users')).toBeNull();
    });

    it('reads ALLOWED_OPERATIONS from env', () => {
      process.env.ALLOW_ALL = 'false';
      process.env.ALLOWED_OPERATIONS = 'SELECT, INSERT , UPDATE ';
      const g = new PermissionGuard();
      expect(g.isAllowAll()).toBe(false);
      expect(Array.from(g.getAllowedOperations()!)).toEqual(['SELECT', 'INSERT', 'UPDATE']);
      expect(g.checkOperationAllowed('SELECT 1')).toBeNull();
      expect(g.checkOperationAllowed('INSERT INTO t VALUES (1)')).toBeNull();
      expect(g.checkOperationAllowed('DELETE FROM t')).not.toBeNull();
    });

    it('defaults to SELECT when ALLOWED_OPERATIONS is unset', () => {
      delete process.env.ALLOW_ALL;
      delete process.env.ALLOWED_OPERATIONS;
      const g = new PermissionGuard();
      expect(g.isAllowAll()).toBe(false);
      expect(Array.from(g.getAllowedOperations()!)).toEqual(['SELECT']);
    });

    it('defaults to SELECT when ALLOWED_OPERATIONS is empty spaces', () => {
      delete process.env.ALLOW_ALL;
      process.env.ALLOWED_OPERATIONS = '   ';
      const g = new PermissionGuard();
      expect(g.isAllowAll()).toBe(false);
      expect(Array.from(g.getAllowedOperations()!)).toEqual(['SELECT']);
    });
  });
});
