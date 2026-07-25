import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseConfig } from '../src/database-config.js';

// Mock @databricks/sql
const mockExecuteStatement = vi.fn();
const mockOpenSession = vi.fn().mockResolvedValue({
  executeStatement: mockExecuteStatement,
  close: vi.fn().mockResolvedValue(undefined),
});
const mockConnect = vi.fn().mockResolvedValue({});
const mockCloseClient = vi.fn().mockResolvedValue(undefined);

vi.mock('@databricks/sql', () => {
  return {
    DBSQLClient: vi.fn().mockImplementation(() => {
      return {
        connect: mockConnect,
        openSession: mockOpenSession,
        close: mockCloseClient,
      };
    }),
  };
});

describe('DatabaseConfig', () => {
  const originalEnv = process.env;
  const mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | boolean | null) => {
    throw new Error(`process.exit(${code})`);
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails if DATABRICKS_HOST is missing', async () => {
    delete process.env.DATABRICKS_HOST;
    process.env.DATABRICKS_TOKEN = 'token';
    process.env.DATABRICKS_HTTP_PATH = '/path';

    await expect(DatabaseConfig.create()).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('fails if DATABRICKS_TOKEN is missing', async () => {
    process.env.DATABRICKS_HOST = 'host';
    delete process.env.DATABRICKS_TOKEN;
    process.env.DATABRICKS_HTTP_PATH = '/path';

    await expect(DatabaseConfig.create()).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('fails if DATABRICKS_HTTP_PATH is missing', async () => {
    process.env.DATABRICKS_HOST = 'host';
    process.env.DATABRICKS_TOKEN = 'token';
    delete process.env.DATABRICKS_HTTP_PATH;

    await expect(DatabaseConfig.create()).rejects.toThrow('process.exit(1)');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('connects successfully when all env vars are provided', async () => {
    process.env.DATABRICKS_HOST = 'adb-123.azuredatabricks.net';
    process.env.DATABRICKS_TOKEN = 'dapi123456';
    process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc';

    const config = await DatabaseConfig.create();

    expect(mockConnect).toHaveBeenCalledWith({
      host: 'adb-123.azuredatabricks.net',
      path: '/sql/1.0/warehouses/abc',
      token: 'dapi123456',
    });
    expect(mockOpenSession).toHaveBeenCalled();

    expect(config.getProductInfo()).toBe('Databricks (adb-123.azuredatabricks.net)');
    expect(config.getSession()).toBeDefined();
    expect(config.getClient()).toBeDefined();
    expect(config.getCapabilities()).toBeDefined();

    // Test close
    await config.close();
    expect(mockCloseClient).toHaveBeenCalled();
  });
});
