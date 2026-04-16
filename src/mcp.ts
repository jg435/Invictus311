// MCP client — connects to a local MCP server over HTTP

type MCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

let sessionId: string | null = null;
let mcpTools: MCPTool[] = [];

const MCP_URL = process.env.MCP_URL || "http://localhost:8000";

async function mcpRequest(method: string, params: unknown = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  // Capture session ID from initialize
  const newSession = res.headers.get("mcp-session-id");
  if (newSession) sessionId = newSession;

  if (!res.ok) throw new Error(`MCP error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`MCP RPC error: ${data.error.message}`);
  return data.result;
}

export async function initMCP(): Promise<MCPTool[]> {
  try {
    // Initialize the MCP session
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "boston311-bot", version: "1.0.0" },
    });

    // List available tools
    const result = await mcpRequest("tools/list");
    mcpTools = result.tools || [];
    console.log(`MCP connected: ${mcpTools.length} tools available`);
    mcpTools.forEach((t) => console.log(`  - ${t.name}: ${t.description.slice(0, 60)}`));
    return mcpTools;
  } catch (e) {
    console.error("MCP connection failed:", e);
    return [];
  }
}

export function getMCPTools(): MCPTool[] {
  return mcpTools;
}

// Convert MCP tools to OpenAI function-calling format for the LLM
export function mcpToolsToOpenAI() {
  return mcpTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export async function callMCPTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const result = await mcpRequest("tools/call", { name, arguments: args });
    // MCP tool results come as content array
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((c: { type: string; text?: string }) => c.text || "")
        .join("\n");
    }
    return JSON.stringify(result);
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
