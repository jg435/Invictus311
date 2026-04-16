// In-memory ticket store for demo

export type Ticket = {
  id: string;
  chatId: number;
  type: string;
  description: string;
  location: string;
  photoUrl?: string;
  status: "submitted" | "in_progress" | "resolved";
  created: string;
  updates: string[];
};

const tickets = new Map<string, Ticket>();
let counter = 9000;

export function createTicket(params: {
  chatId: number;
  type: string;
  description: string;
  location: string;
  photoUrl?: string;
}): Ticket {
  const id = `BOS-${++counter}`;
  const ticket: Ticket = {
    id,
    chatId: params.chatId,
    type: params.type,
    description: params.description,
    location: params.location,
    photoUrl: params.photoUrl,
    status: "submitted",
    created: new Date().toISOString(),
    updates: [`Ticket created and submitted to ${getDepartment(params.type)}.`],
  };
  tickets.set(id, ticket);
  return ticket;
}

export function getTicket(id: string): Ticket | undefined {
  return tickets.get(id.toUpperCase());
}

export function getTicketsForChat(chatId: number): Ticket[] {
  return [...tickets.values()].filter((t) => t.chatId === chatId);
}

function getDepartment(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes("pothole") || lower.includes("street") || lower.includes("sidewalk"))
    return "Public Works Department";
  if (lower.includes("trash") || lower.includes("garbage") || lower.includes("litter"))
    return "Public Works - Sanitation";
  if (lower.includes("tree") || lower.includes("park"))
    return "Parks & Recreation";
  if (lower.includes("noise") || lower.includes("rodent") || lower.includes("pest"))
    return "Inspectional Services";
  if (lower.includes("light") || lower.includes("signal"))
    return "Transportation Department";
  return "Boston 311 Operations";
}
