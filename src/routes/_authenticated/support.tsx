import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  MessageSquare,
  Ticket,
  Inbox,
  Clock,
  Search,
  Send,
  CheckCircle2,
  AlertCircle,
  Circle,
  CircleDot,
  Plus,
  Loader2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import { isFirebaseAvailable } from "@/lib/firebase";
import {
  SUPPORT_CHANNEL_LABEL,
  createSupportTicket,
  markTicketReadByAgent,
  relativeTime,
  sendAgentReply,
  subscribeSupportTickets,
  subscribeTicketMessages,
  updateTicket,
  type SupportChannel,
  type SupportMessage,
  type SupportPriority,
  type SupportStatus,
  type SupportTicket,
} from "@/lib/support.firebase";
import { useStaffSession } from "@/hooks/use-staff-session";

export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({
    meta: [
      { title: "Support — ForkFleet Console" },
      {
        name: "description",
        content:
          "Live customer support inbox backed by Firebase — tickets, chats and replies shared with the customer app.",
      },
      { property: "og:title", content: "Support — ForkFleet Console" },
      {
        property: "og:description",
        content: "Answer customer questions in real time from the ForkFleet operations console.",
      },
    ],
  }),
  component: SupportPage,
});

const statusTone: Record<SupportStatus, string> = {
  open: "bg-destructive/15 text-destructive border-destructive/30",
  in_progress: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  waiting: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  resolved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};
const priorityTone: Record<SupportPriority, string> = {
  low: "border-muted-foreground/30 text-muted-foreground",
  medium: "border-sky-500/30 text-sky-400",
  high: "border-amber-500/30 text-amber-400",
  urgent: "border-destructive/40 text-destructive",
};
const statusIcon: Record<SupportStatus, typeof Circle> = {
  open: AlertCircle,
  in_progress: CircleDot,
  waiting: Clock,
  resolved: CheckCircle2,
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase())
      .join("") || "?"
  );
}

function SupportPage() {
  const { session } = useStaffSession();
  const agentName = session?.fullName ?? session?.email ?? "Support agent";
  const agentId = session?.userId ?? null;

  const [tab, setTab] = useState<"inbox" | "chats" | "calls">("inbox");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SupportStatus>("all");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeSupportTickets((rows) => {
      setTickets(rows);
      setLoading(false);
    });
    return unsub;
  }, []);

  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void markTicketReadByAgent(selectedId);
    const unsub = subscribeTicketMessages(selectedId, setMessages);
    return unsub;
  }, [selectedId]);

  const filtered = useMemo(
    () =>
      tickets.filter((t) => {
        if (tab === "chats" && t.channel !== "chat") return false;
        if (tab === "calls" && t.channel !== "phone") return false;
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const hay = `${t.subject} ${t.customer_name} ${t.id} ${t.order_number ?? ""} ${
            t.customer_email ?? ""
          }`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [tickets, tab, search, statusFilter],
  );

  useEffect(() => {
    if (!selectedId && filtered[0]) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const counts = useMemo(
    () => ({
      open: tickets.filter((t) => t.status === "open").length,
      progress: tickets.filter((t) => t.status === "in_progress").length,
      waiting: tickets.filter((t) => t.status === "waiting").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
      chats: tickets.filter((t) => t.channel === "chat").length,
    }),
    [tickets],
  );

  async function handleSend() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await sendAgentReply({
        ticket_id: selected.id,
        body: reply,
        author_id: agentId,
        author_name: agentName,
      });
      setReply("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function patch(patchInput: Parameters<typeof updateTicket>[1], message: string) {
    if (!selected) return;
    try {
      await updateTicket(selected.id, patchInput);
      toast.success(message);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <PermissionGate
      required={["support.view", "orders.view"]}
      breadcrumb={["Platform", "Support"]}
      title="Customer support"
      description="Live inbox shared with the customer app — tickets, chats and replies sync through Firebase in real time."
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <CircleDot className="size-3 text-emerald-400" />
            {isFirebaseAvailable() ? "Live" : "Offline"}
          </Badge>
          <NewTicketDialog />
        </div>
      }
    >
      {() => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi icon={Inbox} label="Open" value={String(counts.open)} tone="text-destructive" />
            <Kpi
              icon={CircleDot}
              label="In progress"
              value={String(counts.progress)}
              tone="text-sky-400"
            />
            <Kpi
              icon={Clock}
              label="Awaiting customer"
              value={String(counts.waiting)}
              tone="text-amber-400"
            />
            <Kpi
              icon={CheckCircle2}
              label="Resolved"
              value={String(counts.resolved)}
              tone="text-emerald-400"
            />
            <Kpi icon={MessageSquare} label="Live chats" value={String(counts.chats)} />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="inbox">All tickets</TabsTrigger>
              <TabsTrigger value="chats">Live chats</TabsTrigger>
              <TabsTrigger value="calls">Calls</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-4">
              <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
                <Card className="overflow-hidden">
                  <CardContent className="space-y-3 p-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        placeholder="Search tickets…"
                        className="pl-8"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <Select
                      value={statusFilter}
                      onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Filter by status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In progress</SelectItem>
                        <SelectItem value="waiting">Waiting</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                    <ScrollArea className="h-[540px] pr-2">
                      <div className="space-y-1">
                        {filtered.map((t) => {
                          const Icon = statusIcon[t.status];
                          const active = t.id === selected?.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setSelectedId(t.id)}
                              className={
                                "w-full rounded-lg border p-3 text-left transition-colors " +
                                (active
                                  ? "border-primary/50 bg-primary/5"
                                  : "border-border/60 hover:border-border hover:bg-muted/40")
                              }
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-medium">{t.subject}</p>
                                {t.unread_for_agent > 0 && (
                                  <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {t.customer_name}
                                {t.order_number ? ` • ${t.order_number}` : ""}
                              </p>
                              {t.last_message && (
                                <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
                                  {t.last_message_from === "agent" ? "You: " : ""}
                                  {t.last_message}
                                </p>
                              )}
                              <div className="mt-2 flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={`${statusTone[t.status]} gap-1 text-[9px]`}
                                >
                                  <Icon className="size-2.5" /> {t.status.replace("_", " ")}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`${priorityTone[t.priority]} text-[9px] uppercase`}
                                >
                                  {t.priority}
                                </Badge>
                                <span className="ml-auto text-[10px] text-muted-foreground">
                                  {SUPPORT_CHANNEL_LABEL[t.channel]} •{" "}
                                  {relativeTime(t.last_message_at ?? t.created_at)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                        {loading && (
                          <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Loading tickets…
                          </p>
                        )}
                        {!loading && filtered.length === 0 && (
                          <div className="space-y-2 py-10 text-center">
                            <Ticket className="mx-auto size-5 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">
                              {tickets.length === 0
                                ? "No customer tickets yet. They appear here the moment a customer asks a question in the app."
                                : "No tickets match these filters."}
                            </p>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                {selected ? (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base">{selected.subject}</CardTitle>
                            <Badge
                              variant="outline"
                              className={statusTone[selected.status] + " gap-1 text-[10px]"}
                            >
                              {(() => {
                                const Icon = statusIcon[selected.status];
                                return <Icon className="size-3" />;
                              })()}
                              {selected.status.replace("_", " ")}
                            </Badge>
                          </div>
                          <CardDescription className="mt-1">
                            opened {relativeTime(selected.created_at)} ago via{" "}
                            {SUPPORT_CHANNEL_LABEL[selected.channel]}
                            {selected.order_number && (
                              <>
                                {" "}
                                • Order{" "}
                                <span className="font-medium text-foreground">
                                  {selected.order_number}
                                </span>
                              </>
                            )}
                            {selected.restaurant_name && <> • {selected.restaurant_name}</>}
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={selected.priority}
                            onValueChange={(v) =>
                              void patch({ priority: v as SupportPriority }, "Priority updated")
                            }
                          >
                            <SelectTrigger className="h-8 w-[120px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["low", "medium", "high", "urgent"] as SupportPriority[]).map(
                                (p) => (
                                  <SelectItem key={p} value={p}>
                                    {p}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void patch(
                                { assigned_to: agentId, assigned_name: agentName },
                                `Assigned to ${agentName}`,
                              )
                            }
                          >
                            {selected.assigned_name ? `Assigned: ${selected.assigned_name}` : "Assign to me"}
                          </Button>
                          {selected.status === "resolved" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void patch({ status: "open" }, "Ticket reopened")}
                            >
                              Reopen
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => void patch({ status: "resolved" }, "Ticket resolved")}
                            >
                              Resolve
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
                        <Avatar className="size-9">
                          <AvatarFallback className="bg-primary/15 text-xs text-primary">
                            {initials(selected.customer_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{selected.customer_name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {selected.customer_email ?? selected.customer_phone ?? "No contact on file"}
                          </p>
                        </div>
                      </div>

                      <ScrollArea className="h-[360px] pr-2">
                        <div className="space-y-4">
                          {messages.map((m) => (
                            <div
                              key={m.id}
                              className={`flex gap-3 ${m.from === "agent" ? "flex-row-reverse" : ""}`}
                            >
                              <Avatar className="size-8">
                                <AvatarFallback
                                  className={`text-[10px] ${
                                    m.from === "agent"
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted"
                                  }`}
                                >
                                  {initials(m.author_name)}
                                </AvatarFallback>
                              </Avatar>
                              <div
                                className={`max-w-[75%] space-y-1 rounded-lg p-3 ${
                                  m.from === "agent" ? "bg-primary/10" : "bg-muted/40"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-xs font-medium">{m.author_name}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {relativeTime(m.at)}
                                  </p>
                                </div>
                                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                              </div>
                            </div>
                          ))}
                          {messages.length === 0 && (
                            <p className="py-10 text-center text-xs text-muted-foreground">
                              No messages on this ticket yet.
                            </p>
                          )}
                        </div>
                      </ScrollArea>

                      <Separator />
                      <div className="space-y-2">
                        <Textarea
                          placeholder={`Reply to ${selected.customer_name.split(" ")[0]}…`}
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          rows={3}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void handleSend();
                          }}
                        />
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] text-muted-foreground">
                            Delivered to the customer app instantly. ⌘/Ctrl + Enter to send.
                          </p>
                          <Button size="sm" disabled={!reply.trim() || sending} onClick={() => void handleSend()}>
                            {sending ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                              <Send className="mr-1.5 size-3.5" />
                            )}
                            Send reply
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="flex h-[420px] flex-col items-center justify-center gap-2 text-center">
                      <WifiOff className="size-6 text-muted-foreground" />
                      <p className="text-sm font-medium">No conversation selected</p>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        Customer questions raised in the ForkFleet customer app land here in real
                        time. You can also open a ticket manually for a phone or email enquiry.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </PermissionGate>
  );
}

function NewTicketDialog() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    subject: "",
    channel: "phone" as SupportChannel,
    priority: "medium" as SupportPriority,
    order_number: "",
    first_message: "",
  });

  async function submit() {
    setSaving(true);
    try {
      await createSupportTicket({
        subject: form.subject,
        channel: form.channel,
        priority: form.priority,
        customer_name: form.customer_name.trim() || "Customer",
        customer_email: form.customer_email.trim() || null,
        customer_phone: form.customer_phone.trim() || null,
        order_number: form.order_number.trim() || null,
        first_message: form.first_message,
      });
      toast.success("Ticket created");
      setOpen(false);
      setForm({
        customer_name: "",
        customer_email: "",
        customer_phone: "",
        subject: "",
        channel: "phone",
        priority: "medium",
        order_number: "",
        first_message: "",
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-3.5" /> New ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a support ticket</DialogTitle>
          <DialogDescription>
            For phone or email enquiries. The customer sees it in their app immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Customer name</Label>
            <Input
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Order number</Label>
            <Input
              value={form.order_number}
              placeholder="FF-DELIV01"
              onChange={(e) => setForm({ ...form, order_number: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              value={form.customer_email}
              onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={form.customer_phone}
              onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Channel</Label>
            <Select
              value={form.channel}
              onValueChange={(v) => setForm({ ...form, channel: v as SupportChannel })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["phone", "email", "chat", "in_app"] as SupportChannel[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {SUPPORT_CHANNEL_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select
              value={form.priority}
              onValueChange={(v) => setForm({ ...form, priority: v as SupportPriority })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["low", "medium", "high", "urgent"] as SupportPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Subject</Label>
            <Input
              value={form.subject}
              placeholder="Refund request"
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>What did the customer say?</Label>
            <Textarea
              rows={3}
              value={form.first_message}
              onChange={(e) => setForm({ ...form, first_message: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!form.subject.trim() || saving} onClick={() => void submit()}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2">
          <Icon className={`size-4 ${tone ?? "text-primary"}`} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
