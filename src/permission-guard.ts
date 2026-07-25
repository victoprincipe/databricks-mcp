/**
 * Responsible for loading SQL operation permissions from environment variables
 * and validating queries before they reach the database.
 */

const SINGLE_LINE_COMMENT = /--[^\r\n]*/g;
const MULTI_LINE_COMMENT = /\/\*[\s\S]*?\*\//g;

export class PermissionGuard {
  private readonly allowAll: boolean;
  private readonly allowedOperations: ReadonlySet<string> | null;

  /**
   * Creates a PermissionGuard with explicit parameters (for testing).
   */
  constructor(allowAll: boolean, allowedOperations: ReadonlySet<string> | null);
  /**
   * Creates a PermissionGuard by reading env vars.
   */
  constructor();
  constructor(allowAll?: boolean, allowedOperations?: ReadonlySet<string> | null) {
    if (typeof allowAll === 'boolean') {
      // Explicit constructor (for testing)
      this.allowAll = allowAll;
      this.allowedOperations = allowedOperations ?? null;
    } else {
      // Env-var constructor
      const allowAllEnv = process.env.ALLOW_ALL;
      this.allowAll = allowAllEnv?.toLowerCase() === 'true';

      if (this.allowAll) {
        this.allowedOperations = null; // null = unrestricted
        console.error('Permission mode: ALLOW_ALL (all SQL operations permitted)');
      } else {
        const allowedOpsEnv = process.env.ALLOWED_OPERATIONS;
        if (allowedOpsEnv && allowedOpsEnv.trim() !== '') {
          const ops = new Set<string>();
          for (const op of allowedOpsEnv.split(',')) {
            const trimmed = op.trim().toUpperCase();
            if (trimmed !== '') ops.add(trimmed);
          }
          this.allowedOperations = ops;
        } else {
          this.allowedOperations = new Set(['SELECT']);
        }
        const opsStr = this.allowedOperations
          ? Array.from(this.allowedOperations).join(', ')
          : '';
        console.error(
          `Allowed SQL operations: ${opsStr}` +
          (allowedOpsEnv == null ? ' (default — set ALLOWED_OPERATIONS to change)' : ''),
        );
      }
    }
  }

  /**
   * Checks whether the SQL operation in the given query is permitted.
   * @returns null if allowed, or a descriptive error message if denied
   */
  checkOperationAllowed(query: string): string | null {
    if (this.allowAll || this.allowedOperations === null) return null;

    let stripped = query.replace(SINGLE_LINE_COMMENT, ' ');
    stripped = stripped.replace(MULTI_LINE_COMMENT, ' ');

    const trimmed = stripped.trim();
    if (trimmed === '') return 'Empty query is not allowed.';

    const firstToken = trimmed.split(/\s+/)[0].toUpperCase();

    if (!this.allowedOperations.has(firstToken)) {
      const allowed = Array.from(this.allowedOperations).join(', ');
      return (
        `Operation '${firstToken}' is not allowed. Allowed operations: ${allowed}` +
        '. Set ALLOWED_OPERATIONS env var to change permissions.'
      );
    }
    return null;
  }

  isAllowAll(): boolean {
    return this.allowAll;
  }

  getAllowedOperations(): ReadonlySet<string> | null {
    return this.allowedOperations;
  }
}
