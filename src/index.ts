#!/usr/bin/env node

// MCP SQL Server - Production version

import type { Request, Response } from 'express';

async function runServer() {
  try {
    // Dynamic imports to support execution from any working directory
    const { handleCliArgs } = await import('./cli.js');
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const {
      CallToolRequestSchema,
      ListToolsRequestSchema,
    } = await import('@modelcontextprotocol/sdk/types.js');
    const { SqlServerConnection } = await import('./connection.js');
    const { ConnectionConfigSchema } = await import('./types.js');
    const {
      ListDatabasesTool,
      ListTablesTool,
      ListViewsTool,
      DescribeTableTool,
      ExecuteQueryTool,
      GetForeignKeysTool,
      GetServerInfoTool,
      GetTableStatsTool,
      TestConnectionTool,
    } = await import('./tools/index.js');
    const { ErrorHandler } = await import('./errors.js');

    type Connection = InstanceType<typeof SqlServerConnection>;

    // Build the set of MCP tool instances bound to a connection.
    // Factored out so both stdio and HTTP transports share the exact same
    // tool initialization logic (no duplication of read-only semantics).
    function buildTools(connection: Connection, maxRows: number): Map<string, any> {
      const toolClasses = [
        TestConnectionTool,
        ListDatabasesTool,
        ListTablesTool,
        ListViewsTool,
        DescribeTableTool,
        ExecuteQueryTool,
        GetForeignKeysTool,
        GetServerInfoTool,
        GetTableStatsTool,
      ];

      const tools = new Map<string, any>();
      for (const ToolClass of toolClasses) {
        const tool = new ToolClass(connection, maxRows);
        tools.set(tool.getName(), tool);
      }
      return tools;
    }

    // Create a fully configured MCP Server (request handlers + tools) for a
    // given connection. Reused by both transports.
    function createMcpServer(connection: Connection, maxRows: number) {
      const server = new Server(
        {
          name: 'mcp-sqlserver',
          version: '2.0.3',
        },
        {
          capabilities: {
            tools: {},
          },
        }
      );

      server.onerror = (error: Error) => {
        console.error('[MCP Error]', error);
      };

      const tools = buildTools(connection, maxRows);

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
          tools: Array.from(tools.values()).map(tool => ({
            name: tool.getName(),
            description: tool.getDescription(),
            inputSchema: tool.getInputSchema(),
          })),
        };
      });

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        if (!tools.has(name)) {
          throw new Error(`Unknown tool: ${name}`);
        }

        const tool = tools.get(name);

        try {
          const result = await tool.execute(args || {});
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const mcpError = ErrorHandler.handleSqlServerError(error);
          const userError = ErrorHandler.formatErrorForUser(mcpError);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: userError.error,
                  code: userError.code,
                  suggestions: userError.suggestions,
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      });

      return server;
    }

    // stdio transport - unchanged behavior (single long-lived server)
    async function runStdio(connection: Connection, maxRows: number) {
      const server = createMcpServer(connection, maxRows);
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('MCP SQL Server running on stdio');
    }

    // Streamable HTTP transport (stateless) - reachable on POST /mcp
    async function runHttp(connection: Connection, maxRows: number) {
      const express = (await import('express')).default;
      const { StreamableHTTPServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/streamableHttp.js'
      );

      const app = express();
      app.use(express.json());

      const port = parseInt(process.env.PORT || '8000');
      const allowedHosts = (process.env.MCP_ALLOWED_HOSTS || '')
        .split(',')
        .map(h => h.trim())
        .filter(Boolean);

      // Lightweight health endpoint for Docker healthchecks - never touches SQL.
      app.get('/health', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'ok' });
      });

      // Stateless: create a fresh server + transport per request.
      app.post('/mcp', async (req: Request, res: Response) => {
        const server = createMcpServer(connection, maxRows);
        // Stateless mode: omit sessionIdGenerator entirely (the SDK treats its
        // absence as "session management disabled").
        const transport = new StreamableHTTPServerTransport(
          allowedHosts.length > 0
            ? {
                enableDnsRebindingProtection: true,
                allowedHosts,
              }
            : {}
        );

        res.on('close', () => {
          transport.close();
          server.close();
        });

        try {
          // Cast: the HTTP transport's onclose accessor is typed `| undefined`,
          // which trips exactOptionalPropertyTypes against the Transport interface.
          await server.connect(transport as any);
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          console.error('Error handling MCP request:', error);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            });
          }
        }
      });

      // Stateless mode does not support GET (SSE stream) or DELETE (session end).
      const methodNotAllowed = (_req: Request, res: Response) => {
        res.status(405).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        });
      };
      app.get('/mcp', methodNotAllowed);
      app.delete('/mcp', methodNotAllowed);

      app.listen(port, '0.0.0.0', () => {
        console.error(`MCP SQL Server running on Streamable HTTP at http://0.0.0.0:${port}/mcp`);
      });
    }

    async function main() {
      // Handle CLI arguments and help
      if (!handleCliArgs()) {
        return;
      }

      // Read configuration from environment variables
      const config = {
        server: process.env.SQLSERVER_HOST || 'localhost',
        database: process.env.SQLSERVER_DATABASE,
        user: process.env.SQLSERVER_USER || '',
        password: process.env.SQLSERVER_PASSWORD || '',
        port: parseInt(process.env.SQLSERVER_PORT || '1433'),
        encrypt: process.env.SQLSERVER_ENCRYPT !== 'false',
        trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== 'false',
        connectionTimeout: parseInt(process.env.SQLSERVER_CONNECTION_TIMEOUT || '30000'),
        requestTimeout: parseInt(process.env.SQLSERVER_REQUEST_TIMEOUT || '60000'),
        maxRows: parseInt(process.env.SQLSERVER_MAX_ROWS || '1000'),
      };

      // Validate configuration
      try {
        ConnectionConfigSchema.parse(config);
      } catch (error) {
        console.error('Invalid configuration:', error);
        process.exit(1);
      }

      if (!config.user || !config.password) {
        console.error('Error: SQLSERVER_USER and SQLSERVER_PASSWORD environment variables are required');
        process.exit(1);
      }

      // Build the shared connection. Connection is deferred (not opened until the
      // first tool use) so the server starts even if SQL Server is briefly down.
      const connection = new SqlServerConnection(config);
      console.error(`MCP SQL Server initialized for ${config.server}:${config.port || 1433}`);
      console.error(`Database: ${config.database || 'default'}, User: ${config.user}`);

      // Graceful shutdown - close the shared connection pool.
      const cleanup = async () => {
        await connection.disconnect();
      };
      process.on('SIGINT', async () => {
        await cleanup();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await cleanup();
        process.exit(0);
      });

      const transportMode = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
      const maxRows = config.maxRows || 1000;

      try {
        if (transportMode === 'http') {
          await runHttp(connection, maxRows);
        } else {
          await runStdio(connection, maxRows);
        }
      } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
      }
    }

    await main();

  } catch (error) {
    console.error('Failed to start MCP server:', (error as Error).message);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
