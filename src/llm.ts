// OpenRouter LLM client with tool use

import { searchCases, lookupCase, getStats, getNeighborhoodSummary } from "./boston";
import { createTicket, getTicket, getTicketsForChat, Ticket } from "./tickets";
import { submit311Ticket } from "./submit311";
import { mcpToolsToOpenAI, callMCPTool, getMCPTools } from "./mcp";

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_311_cases",
      description: "Search Boston 311 service requests. Use this when someone asks about reports, complaints, or issues in a neighborhood or of a specific type.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["Open", "Closed"], description: "Filter by case status" },
          neighborhood: { type: "string", description: "Neighborhood name (e.g. Roxbury, South Boston, Back Bay)" },
          type: { type: "string", description: "Issue type keyword (e.g. pothole, graffiti, trash, noise, streetlight)" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "lookup_311_case",
      description: "Look up a specific 311 case by its ID number.",
      parameters: {
        type: "object",
        properties: {
          case_id: { type: "string", description: "The case enquiry ID" },
        },
        required: ["case_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_311_stats",
      description: "Get statistics on 311 requests — top issue types by count, optionally filtered by neighborhood and time window.",
      parameters: {
        type: "object",
        properties: {
          neighborhood: { type: "string", description: "Optional neighborhood filter" },
          days: { type: "number", description: "Days to look back (default 7)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_neighborhood_summary",
      description: "Get a summary of 311 activity for a neighborhood: total requests (30 days), open cases, and top issues.",
      parameters: {
        type: "object",
        properties: {
          neighborhood: { type: "string", description: "Neighborhood name" },
        },
        required: ["neighborhood"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_311_ticket",
      description: "Create a new 311 service request ticket. Use this when someone wants to report an issue like a pothole, graffiti, broken streetlight, trash, etc.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Issue type (e.g. Pothole, Graffiti, Streetlight, Trash)" },
          description: { type: "string", description: "Detailed description of the issue" },
          location: { type: "string", description: "Street address or location description" },
        },
        required: ["type", "description", "location"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_ticket_status",
      description: "Check the status of a previously created ticket by its ID (e.g. BOS-9001).",
      parameters: {
        type: "object",
        properties: {
          ticket_id: { type: "string", description: "Ticket ID (e.g. BOS-9001)" },
        },
        required: ["ticket_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_my_tickets",
      description: "List all tickets the current user has created in this session.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const SYSTEM_PROMPT = `You are Boston 311 Assistant, a friendly multilingual chatbot on Telegram that helps Boston residents with city services.

You can:
1. Answer questions about 311 service requests using real Boston data
2. Help residents report new issues (potholes, graffiti, trash, noise, etc.)
3. Check the status of existing tickets
4. Provide neighborhood-level stats and summaries
5. Analyze photos of city issues that residents send you
6. Query Boston's open data portal for crime incidents, permits, and other city data using the ckan__ tools (search datasets, query data, execute SQL)

IMPORTANT RULES:
- Detect the user's language from their message and ALWAYS respond in that same language.
- If they write in Spanish, respond in Spanish. Chinese → Chinese. Portuguese → Portuguese. Etc.
- Keep responses concise — this is a chat app, not an essay.
- Use emoji sparingly but naturally.
- When creating a ticket, confirm the details with the user before submitting.
- When showing data, format it nicely for mobile (short lines, bullet points).
- If a photo was sent, the user is probably reporting an issue — analyze what you see and offer to create a ticket.
- CRITICAL: When creating tickets, the location MUST be a Boston address. Always append "Boston, MA" to the address. If the user gives an address outside Boston, tell them Boston 311 only covers Boston.
- This creates REAL tickets on 311.boston.gov. Always confirm with the user before submitting.`;

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  chatId: number,
  photoPath?: string
): Promise<string> {
  switch (name) {
    case "search_311_cases": {
      const results = await searchCases(args as { status?: string; neighborhood?: string; type?: string; limit?: number });
      if (results.length === 0) return JSON.stringify({ message: "No cases found matching those criteria." });
      return JSON.stringify(results.slice(0, 10));
    }
    case "lookup_311_case": {
      const result = await lookupCase(String(args.case_id));
      if (!result) return JSON.stringify({ message: `No case found with ID ${args.case_id}` });
      return JSON.stringify(result);
    }
    case "get_311_stats": {
      const stats = await getStats(args as { neighborhood?: string; days?: number });
      return JSON.stringify(stats);
    }
    case "get_neighborhood_summary": {
      const summary = await getNeighborhoodSummary(String(args.neighborhood));
      return JSON.stringify(summary);
    }
    case "create_311_ticket": {
      // Submit to real 311.boston.gov via Playwright
      const result = await submit311Ticket({
        category: String(args.type),
        description: String(args.description),
        address: String(args.location),
        photoPath,
      });

      if (result.success) {
        // Also save locally for tracking
        const ticket = createTicket({
          chatId,
          type: String(args.type),
          description: String(args.description),
          location: String(args.location),
        });
        return JSON.stringify({
          ticket_id: ticket.id,
          real_ticket_url: result.url,
          status: "submitted",
          message: `Ticket submitted to Boston 311! View it at: ${result.url}`,
        });
      } else {
        return JSON.stringify({
          status: "failed",
          error: result.error,
          message: "Failed to submit ticket to Boston 311. Please try again or call 311 directly.",
        });
      }
    }
    case "check_ticket_status": {
      const ticket = getTicket(String(args.ticket_id));
      if (!ticket) return JSON.stringify({ message: `No ticket found with ID ${args.ticket_id}` });
      return JSON.stringify({ id: ticket.id, type: ticket.type, status: ticket.status, location: ticket.location, created: ticket.created, updates: ticket.updates });
    }
    case "list_my_tickets": {
      const tickets = getTicketsForChat(chatId);
      if (tickets.length === 0) return JSON.stringify({ message: "You haven't created any tickets yet." });
      return JSON.stringify(tickets.map((t: Ticket) => ({ id: t.id, type: t.type, status: t.status, location: t.location })));
    }
    default: {
      // Check if it's an MCP tool
      const mcpTools = getMCPTools();
      if (mcpTools.some((t) => t.name === name)) {
        return callMCPTool(name, args);
      }
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  }
}

export async function chat(
  chatId: number,
  history: Message[],
  userMessage: string,
  imageUrl?: string,
  onStatus?: (text: string) => void,
  photoPath?: string
): Promise<{ reply: string; history: Message[] }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  // Build user message with optional image
  if (imageUrl) {
    messages.push({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: userMessage || "I want to report this issue. What do you see? Can you help me create a ticket?" },
      ],
    });
  } else {
    messages.push({ role: "user", content: userMessage });
  }

  // Agent loop
  let done = false;
  let lastAssistantText = "";

  while (!done) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4.5",
        max_tokens: 2048,
        tools: [...TOOLS, ...mcpToolsToOpenAI()],
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const choice = data.choices[0];
    const msg = choice.message;

    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: msg.tool_calls,
    });

    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        const args = JSON.parse(tc.function.arguments);
        console.log(`Tool call: ${fnName}(${JSON.stringify(args).slice(0, 100)})`);

        // Send progress messages for slow operations
        if (fnName === "create_311_ticket" && onStatus) {
          onStatus("📝 Creating your ticket on 311.boston.gov — this takes about 15 seconds...");
        } else if (fnName.startsWith("search_") || fnName.startsWith("get_") || fnName.startsWith("lookup_")) {
          if (onStatus) onStatus("🔍 Looking that up...");
        }

        const result = await handleToolCall(fnName, args, chatId, photoPath);
        console.log(`Tool result: ${fnName} → ${result.slice(0, 150)}`);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    } else {
      done = true;
      lastAssistantText = msg.content || "";
    }
  }

  // Return updated history (without system prompt)
  const updatedHistory = messages.slice(1);
  return { reply: lastAssistantText, history: updatedHistory };
}
