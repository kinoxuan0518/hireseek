/**
 * MCP (Model Context Protocol) 客户端
 * 支持连接各种 MCP 服务器（Notion、GitHub、浏览器等）
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool, Resource } from '@modelcontextprotocol/sdk/types.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPConnection {
  name: string;
  client: Client;
  tools: Tool[];
  resources: Resource[];
}

class MCPClientManager {
  private connections: Map<string, MCPConnection> = new Map();

  /**
   * 连接到 MCP 服务器
   */
  async connect(config: MCPServerConfig): Promise<void> {
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env ? { ...process.env, ...config.env } as any : process.env as any,
      });

      const client = new Client(
        {
          name: 'hireclaw',
          version: '0.1.0',
        },
        {
          capabilities: {} as any,
        }
      );

      await client.connect(transport);

      // 获取服务器提供的工具和资源
      const toolsList = await client.listTools();
      const resourcesList = await client.listResources();

      this.connections.set(config.name, {
        name: config.name,
        client,
        tools: toolsList.tools || [],
        resources: resourcesList.resources || [],
      });

      console.log(`[MCP] ✓ 已连接到 ${config.name}`);
      console.log(`  - 工具: ${toolsList.tools?.length || 0} 个`);
      console.log(`  - 资源: ${resourcesList.resources?.length || 0} 个`);
    } catch (err: any) {
      console.error(`[MCP] ✗ 连接 ${config.name} 失败:`, err.message);
      throw err;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    await conn.client.close();
    this.connections.delete(serverName);
    console.log(`[MCP] 已断开 ${serverName}`);
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    for (const [name] of this.connections) {
      await this.disconnect(name);
    }
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP 服务器 ${serverName} 未连接`);
    }

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args });
      return result;
    } catch (err: any) {
      throw new Error(`调用工具失败: ${err.message}`);
    }
  }

  /**
   * 读取 MCP 资源
   */
  async readResource(serverName: string, uri: string): Promise<any> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP 服务器 ${serverName} 未连接`);
    }

    try {
      const result = await conn.client.readResource({ uri });
      return result;
    } catch (err: any) {
      throw new Error(`读取资源失败: ${err.message}`);
    }
  }

  /**
   * 列出所有连接的服务器
   */
  listConnections(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * 获取服务器的工具列表
   */
  getTools(serverName: string): Tool[] {
    const conn = this.connections.get(serverName);
    return conn?.tools || [];
  }

  /**
   * 获取服务器的资源列表
   */
  getResources(serverName: string): Resource[] {
    const conn = this.connections.get(serverName);
    return conn?.resources || [];
  }

  /**
   * 检查服务器是否已连接
   */
  isConnected(serverName: string): boolean {
    return this.connections.has(serverName);
  }
}

// 单例
export const mcpClient = new MCPClientManager();

/**
 * 从配置文件加载并连接所有 MCP 服务器
 */
export async function initializeMCPServers(servers: MCPServerConfig[]): Promise<void> {
  console.log(`[MCP] 开始连接 ${servers.length} 个 MCP 服务器...\n`);

  for (const server of servers) {
    try {
      await mcpClient.connect(server);
    } catch (err) {
      console.error(`[MCP] 跳过 ${server.name}（连接失败）`);
    }
  }

  console.log(`\n[MCP] 初始化完成，已连接 ${mcpClient.listConnections().length} 个服务器\n`);
}
