- **Vulnerability:** SQL Injection
- **Severity:** Critical
- **Location:** `/Users/onur/Projects/mcp-sqlserver/src/tools/get-foreign-keys.ts`
- **Line Content:**
  ```typescript
      conditions.push(`OBJECT_NAME(fk.parent_object_id) = '${table_name.replace(/'/g, "''")}'`);
    }
    
    if (schema && table_name) {
      conditions.push(`OBJECT_SCHEMA_NAME(fk.parent_object_id) = '${schema.replace(/'/g, "''")}'`);
    }
  ```
- **Description:** The `table_name` and `schema` parameters are directly concatenated into a SQL query with insufficient escaping. The use of `.replace(/'/g, "''")` is a weak form of sanitization that can be bypassed, leading to SQL injection. An attacker could provide a malicious table or schema name to execute arbitrary SQL commands.
- **Recommendation:** Use `ParameterValidator.validateTableName` and `ParameterValidator.validateSchemaName` to validate the input, and then use `ParameterValidator.escapeIdentifier` to safely escape the identifiers before including them in the query. Alternatively, use parameterized queries if the library supports them for identifiers.

- **Vulnerability:** SQL Injection
- **Severity:** Critical
- **Location:** `/Users/onur/Projects/mcp-sqlserver/src/tools/get-table-stats.ts`
- **Line Content:**
  ```typescript
    if (table_name) {
      conditions.push(`t.name = '${table_name.replace(/'/g, "''")}'`);
    }
    
    if (schema && table_name) {
      conditions.push(`s.name = '${schema.replace(/'/g, "''")}'`);
    }
  ```
- **Description:** The `table_name` and `schema` parameters are directly concatenated into a SQL query with insufficient escaping. The use of `.replace(/'/g, "''")` is a weak form of sanitization that can be bypassed, leading to SQL injection. An attacker could provide a malicious table or schema name to execute arbitrary SQL commands.
- **Recommendation:** Use `ParameterValidator.validateTableName` and `ParameterValidator.validateSchemaName` to validate the input, and then use `ParameterValidator.escapeIdentifier` to safely escape the identifiers before including them in the query. Alternatively, use parameterized queries if the library supports them for identifiers.

- **Vulnerability:** SQL Injection
- **Severity:** Critical
- **Location:** `/Users/onur/Projects/mcp-sqlserver/src/tools/list-views.ts`
- **Line Content:**
  ```typescript
    if (schema) {
      query += ` WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}'`;
    }
  ```
- **Description:** The `schema` parameter is directly concatenated into a SQL query with insufficient escaping. The use of `.replace(/'/g, "''")` is a weak form of sanitization that can be bypassed, leading to SQL injection. An attacker could provide a malicious schema name to execute arbitrary SQL commands.
- **Recommendation:** Use `ParameterValidator.validateSchemaName` to validate the input, and then use `ParameterValidator.escapeIdentifier` to safely escape the identifier before including it in the query.

- **Vulnerability:** SQL Injection in `execute_query` tool
- **Severity:** Critical
- **Location:** `/Users/onur/Projects/mcp-sqlserver/src/tools/execute-query.ts`
- **Line Content:**
  ```typescript
      const result = await this.executeQuery(query);
  ```
- **Description:** The `execute_query` tool takes a raw SQL query from the user and relies on the `QueryValidator` in `security.ts` to prevent malicious queries. The `QueryValidator` uses a blacklist of keywords and simple regex patterns, which is an insufficient defense against SQL injection. A moderately skilled attacker can bypass these checks and execute arbitrary SQL commands.
- **Recommendation:** The `execute_query` tool is inherently dangerous. The best practice is to use parameterized queries, but since the user provides the entire query, this is not possible. The `QueryValidator` should be significantly improved with more robust parsing and validation, or the tool should be redesigned to not take raw queries. For example, it could be limited to only `SELECT` statements on a specific set of tables.