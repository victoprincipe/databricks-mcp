import type { DBSQLSessionType } from './database-config.js';

/**
 * Detects database capabilities lazily on first use and caches the results.
 *
 * Three capabilities are detected:
 *   - hasCatalogs:          whether SHOW CATALOGS works (Unity Catalog / multi-catalog)
 *   - hasInformationSchema: whether information_schema.columns is queryable
 *   - isDatabricks:         whether the connected product is Spark/Databricks
 *
 * All detections are silent on failure.
 */
export class DbCapabilities {
  private readonly session: DBSQLSessionType;
  private readonly _isDatabricks: boolean;

  private _hasCatalogs: boolean | null = null; // null = not yet detected
  private _hasInformationSchema: boolean | null = null; // null = not yet detected
  private _firstCatalog: string | null = null;

  // Prevent concurrent detection calls
  private _hasCatalogsPromise: Promise<boolean> | null = null;
  private _hasInfoSchemaPromise: Promise<boolean> | null = null;

  constructor(session: DBSQLSessionType, productName: string | null) {
    this.session = session;
    const name = productName?.toLowerCase() ?? '';
    this._isDatabricks = name.includes('spark') || name.includes('databricks');
  }

  /**
   * Returns true if SHOW CATALOGS is supported (Unity Catalog or equivalent).
   * Result is cached after the first call.
   */
  async hasCatalogs(): Promise<boolean> {
    if (this._hasCatalogs !== null) return this._hasCatalogs;

    if (!this._hasCatalogsPromise) {
      this._hasCatalogsPromise = this.tryShowCatalogs().then((result) => {
        this._hasCatalogs = result;
        console.error(
          `[capabilities] hasCatalogs=${result}` +
            (this._firstCatalog ? ` (firstCatalog=${this._firstCatalog})` : ''),
        );
        return result;
      });
    }
    return this._hasCatalogsPromise;
  }

  /**
   * Returns true if information_schema.columns is queryable.
   * Depends on hasCatalogs():
   *   hasCatalogs=true  → tests `{firstCatalog}`.information_schema.columns
   *   hasCatalogs=false → tests information_schema.columns (unqualified)
   * Result is cached after the first call.
   */
  async hasInformationSchema(): Promise<boolean> {
    if (this._hasInformationSchema !== null) return this._hasInformationSchema;

    if (!this._hasInfoSchemaPromise) {
      this._hasInfoSchemaPromise = (async () => {
        const catalogs = await this.hasCatalogs();
        let result: boolean;
        if (catalogs) {
          result = await this.tryInformationSchemaWithCatalog();
        } else {
          result = await this.tryInformationSchemaPlain();
        }
        this._hasInformationSchema = result;
        console.error(`[capabilities] hasInformationSchema=${result}`);
        return result;
      })();
    }
    return this._hasInfoSchemaPromise;
  }

  /**
   * Returns true if the connected product is Spark or Databricks.
   * Resolved immediately at construction time — no query needed.
   */
  isDatabricks(): boolean {
    return this._isDatabricks;
  }

  /**
   * Returns a human-readable summary of all resolved capabilities.
   * Only shows capabilities that have already been detected.
   */
  describe(): string {
    const parts: string[] = [`isDatabricks=${this._isDatabricks}`];
    if (this._hasCatalogs !== null) parts.push(`hasCatalogs=${this._hasCatalogs}`);
    else parts.push('hasCatalogs=<not yet detected>');
    if (this._hasInformationSchema !== null)
      parts.push(`hasInformationSchema=${this._hasInformationSchema}`);
    else parts.push('hasInformationSchema=<not yet detected>');
    return parts.join(', ');
  }

  // ── private detection methods ──────────────────────────────────────────────

  private async tryShowCatalogs(): Promise<boolean> {
    try {
      const op = await this.session.executeStatement('SHOW CATALOGS', {
        runAsync: true,
      });
      const result = await op.fetchAll();
      await op.close();
      if (result.length > 0) {
        const row = result[0] as Record<string, unknown>;
        this._firstCatalog = String(Object.values(row)[0]);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async tryInformationSchemaWithCatalog(): Promise<boolean> {
    if (!this._firstCatalog) return false;
    try {
      const op = await this.session.executeStatement(
        `SELECT 1 FROM \`${this._firstCatalog}\`.information_schema.columns LIMIT 1`,
        { runAsync: true },
      );
      await op.fetchAll();
      await op.close();
      return true;
    } catch {
      return false;
    }
  }

  private async tryInformationSchemaPlain(): Promise<boolean> {
    try {
      const op = await this.session.executeStatement(
        'SELECT 1 FROM information_schema.columns LIMIT 1',
        { runAsync: true },
      );
      await op.fetchAll();
      await op.close();
      return true;
    } catch {
      return false;
    }
  }
}
