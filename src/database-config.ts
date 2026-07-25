import { DBSQLClient } from '@databricks/sql';
import { DbCapabilities } from './db-capabilities.js';

export type DBSQLSessionType = Awaited<ReturnType<DBSQLClient['openSession']>>;

/**
 * Responsible for reading Databricks environment variables,
 * establishing the connection, opening a session, and exposing
 * DbCapabilities for lazy detection.
 */
export class DatabaseConfig {
  private readonly client: DBSQLClient;
  private readonly session: DBSQLSessionType;
  private readonly capabilities: DbCapabilities;
  private readonly productInfo: string;

  private constructor(
    client: DBSQLClient,
    session: DBSQLSessionType,
    capabilities: DbCapabilities,
    productInfo: string,
  ) {
    this.client = client;
    this.session = session;
    this.capabilities = capabilities;
    this.productInfo = productInfo;
  }

  /**
   * Creates and initializes a DatabaseConfig by connecting to Databricks.
   * Factory method because constructor cannot be async.
   */
  static async create(): Promise<DatabaseConfig> {
    const host = process.env.DATABRICKS_HOST;
    const token = process.env.DATABRICKS_TOKEN;
    const httpPath = process.env.DATABRICKS_HTTP_PATH;

    if (!host) {
      console.error('Error: DATABRICKS_HOST environment variable is required.');
      console.error('Example: adb-123456789.12.azuredatabricks.net');
      process.exit(1);
    }
    if (!token) {
      console.error('Error: DATABRICKS_TOKEN environment variable is required.');
      console.error('Set this to your Databricks Personal Access Token.');
      process.exit(1);
    }
    if (!httpPath) {
      console.error('Error: DATABRICKS_HTTP_PATH environment variable is required.');
      console.error('Example: /sql/1.0/warehouses/abc123def456');
      process.exit(1);
    }

    console.error('Attempting to connect to Databricks...');

    const client = new DBSQLClient();
    await client.connect({ host, path: httpPath, token });

    const session = await client.openSession();

    // For Databricks, the product name is always Databricks/Spark
    const productName = 'Databricks';
    const productInfo = `Databricks (${host})`;

    const capabilities = new DbCapabilities(session, productName);

    console.error('Successfully connected to Databricks.');
    console.error(`Database: ${productInfo}`);
    console.error(`Capabilities: ${capabilities.describe()}`);

    return new DatabaseConfig(client, session, capabilities, productInfo);
  }

  getSession(): DBSQLSessionType {
    return this.session;
  }

  getClient(): DBSQLClient {
    return this.client;
  }

  getCapabilities(): DbCapabilities {
    return this.capabilities;
  }

  getProductInfo(): string {
    return this.productInfo;
  }

  async close(): Promise<void> {
    try {
      await this.session.close();
    } catch { /* ignore */ }
    try {
      await this.client.close();
    } catch { /* ignore */ }
  }
}
