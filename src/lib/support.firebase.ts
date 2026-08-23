// Firebase-backed customer support desk.
//
// Realtime Database layout (shared with the CUSTOMER APP):
//   /support/tickets/{ticketId}                 -> SupportTicket
//   /support/messages/{ticketId}/{messageId}    -> SupportMessage
//   /support/presence/agents/{agentId}          -> AgentPresence
//
// The customer app WRITES tickets + customer messages and READS agent
// replies/status. This console READS everything and writes agent replies,
// status/priority/assignment changes. See
// docs/CUSTOMER_APP_SUPPORT_INTEGRATION.md for the contract.

import { isFirebaseAvailable, rtdbGet, rtdbSet, rtdbSubscribe, rtdbUpdate } from "@/lib/firebase";
import type { RTDBValue } from "@/lib/firebase";

export type SupportChannel = "chat" | "email" | "phone" | "in_app";
export type SupportStatus = "open" | "in_progress" | "waiting" | "resolved";
export type SupportPriority = "low" | "medium" | "high" | "urgent";

export interface SupportTicket {
  id: string;
  subject: string;
  channel: SupportChannel;
  status: SupportStatus;
  priority: SupportPriority;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  order_id: string | null;
  order_number: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_from: "customer" | "agent" | null;
  unread_for_agent: number;
  unread_for_customer: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  from: "customer" | "agent" | "system";
  author_id: string | null;
  author_name: string;
  body: string;
  attachment_url: string | null;
  at: string;
}

export const SUPPORT_CHANNEL_LABEL: Record<SupportChannel, string> = {
  chat: "Chat",
  email: "Email",
  phone: "Phone",
  in_app: "In-app",
};

const TICKETS = "support/tickets";
const MESSAGES = "support/messages";

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function coerceTicket(id: string, raw: Partial<SupportTicket> | null): SupportTicket {
  const now = raw?.created_at ?? new Date().toISOString();
  return {
    id,
    subject: raw?.subject ?? "(no subject)",
    channel: (raw?.channel as SupportChannel) ?? "chat",
    status: (raw?.status as SupportStatus) ?? "open",
    priority: (raw?.priority as SupportPriority) ?? "medium",
    customer_id: raw?.customer_id ?? null,
    customer_name: raw?.customer_name ?? "Customer",
    customer_email: raw?.customer_email ?? null,
    customer_phone: raw?.customer_phone ?? null,
    order_id: raw?.order_id ?? null,
    order_number: raw?.order_number ?? null,
    restaurant_id: raw?.restaurant_id ?? null,
    restaurant_name: raw?.restaurant_name ?? null,
    assigned_to: raw?.assigned_to ?? null,
    assigned_name: raw?.assigned_name ?? null,
    last_message: raw?.last_message ?? null,
    last_message_at: raw?.last_message_at ?? null,
    last_message_from: raw?.last_message_from ?? null,
    unread_for_agent: Number(raw?.unread_for_agent ?? 0),
    unread_for_customer: Number(raw?.unread_for_customer ?? 0),
    created_at: now,
    updated_at: raw?.updated_at ?? now,
    resolved_at: raw?.resolved_at ?? null,
  };
}

function toList(raw: Record<string, Partial<SupportTicket>> | null): SupportTicket[] {
  if (!raw) return [];
  return Object.entries(raw)
    .map(([id, t]) => coerceTicket(id, t))
    .sort((a, b) =>
      (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at),
    );
}

export async function listSupportTickets(): Promise<SupportTicket[]> {
  if (!isFirebaseAvailable()) return [];
  return toList(await rtdbGet<Record<string, Partial<SupportTicket>>>(TICKETS));
}

export function subscribeSupportTickets(cb: (tickets: SupportTicket[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, Partial<SupportTicket>> | null>(TICKETS, (raw) =>
    cb(toList(raw)),
  );
}

export function subscribeTicketMessages(
  ticketId: string,
  cb: (messages: SupportMessage[]) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, Partial<SupportMessage>> | null>(
    `${MESSAGES}/${ticketId}`,
    (raw) => {
      const list = Object.entries(raw ?? {})
        .map(([id, m]) => ({
          id,
          ticket_id: ticketId,
          from: (m?.from as SupportMessage["from"]) ?? "customer",
          author_id: m?.author_id ?? null,
          author_name: m?.author_name ?? "Unknown",
          body: m?.body ?? "",
          attachment_url: m?.attachment_url ?? null,
          at: m?.at ?? new Date().toISOString(),
        }))
        .sort((a, b) => a.at.localeCompare(b.at));
      cb(list);
    },
  );
}

/** Agent reply — also refreshes the ticket summary the customer app reads. */
export async function sendAgentReply(input: {
  ticket_id: string;
  body: string;
  author_id?: string | null;
  author_name: string;
}): Promise<SupportMessage> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const body = input.body.trim();
  if (!body) throw new Error("Message cannot be empty.");
  const at = new Date().toISOString();
  const id = newId("msg");
  const message: SupportMessage = {
    id,
    ticket_id: input.ticket_id,
    from: "agent",
    author_id: input.author_id ?? null,
    author_name: input.author_name,
    body,
    attachment_url: null,
    at,
  };
  await rtdbSet(`${MESSAGES}/${input.ticket_id}/${id}`, message as unknown as RTDBValue);
  const existing = await rtdbGet<Partial<SupportTicket>>(`${TICKETS}/${input.ticket_id}`);
  await rtdbUpdate(`${TICKETS}/${input.ticket_id}`, {
    last_message: body.slice(0, 160),
    last_message_at: at,
    last_message_from: "agent",
    unread_for_agent: 0,
    unread_for_customer: Number(existing?.unread_for_customer ?? 0) + 1,
    status: existing?.status === "open" ? "in_progress" : (existing?.status ?? "in_progress"),
    updated_at: at,
  });
  return message;
}

export async function updateTicket(
  ticketId: string,
  patch: Partial<
    Pick<SupportTicket, "status" | "priority" | "assigned_to" | "assigned_name" | "subject">
  >,
): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const at = new Date().toISOString();
  const payload: Record<string, RTDBValue> = { ...patch, updated_at: at };
  if (patch.status === "resolved") payload["resolved_at"] = at;
  if (patch.status && patch.status !== "resolved") payload["resolved_at"] = null;
  await rtdbUpdate(`${TICKETS}/${ticketId}`, payload);
}

export async function markTicketReadByAgent(ticketId: string): Promise<void> {
  if (!isFirebaseAvailable()) return;
  await rtdbUpdate(`${TICKETS}/${ticketId}`, { unread_for_agent: 0 });
}

/** Used by the customer app contract — also lets operators open a ticket
 *  on a customer's behalf (phone/email channels). */
export async function createSupportTicket(input: {
  subject: string;
  channel?: SupportChannel;
  priority?: SupportPriority;
  customer_id?: string | null;
  customer_name: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  restaurant_id?: string | null;
  restaurant_name?: string | null;
  first_message?: string | null;
}): Promise<SupportTicket> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const subject = input.subject.trim();
  if (!subject) throw new Error("A subject is required.");
  const at = new Date().toISOString();
  const id = newId("tkt");
  const body = (input.first_message ?? "").trim();
  const ticket: SupportTicket = {
    id,
    subject,
    channel: input.channel ?? "in_app",
    status: "open",
    priority: input.priority ?? "medium",
    customer_id: input.customer_id ?? null,
    customer_name: input.customer_name,
    customer_email: input.customer_email ?? null,
    customer_phone: input.customer_phone ?? null,
    order_id: input.order_id ?? null,
    order_number: input.order_number ?? null,
    restaurant_id: input.restaurant_id ?? null,
    restaurant_name: input.restaurant_name ?? null,
    assigned_to: null,
    assigned_name: null,
    last_message: body ? body.slice(0, 160) : null,
    last_message_at: body ? at : null,
    last_message_from: body ? "customer" : null,
    unread_for_agent: body ? 1 : 0,
    unread_for_customer: 0,
    created_at: at,
    updated_at: at,
    resolved_at: null,
  };
  await rtdbSet(`${TICKETS}/${id}`, ticket as unknown as RTDBValue);
  if (body) {
    const mid = newId("msg");
    await rtdbSet(`${MESSAGES}/${id}/${mid}`, {
      id: mid,
      ticket_id: id,
      from: "customer",
      author_id: input.customer_id ?? null,
      author_name: input.customer_name,
      body,
      attachment_url: null,
      at,
    } as unknown as RTDBValue);
  }
  return ticket;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
