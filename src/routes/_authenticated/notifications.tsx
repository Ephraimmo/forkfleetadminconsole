import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Bell, BellRing, CheckCheck, Loader2, Send, Trash2, Zap } from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useInAppAlerts } from "@/hooks/use-in-app-alerts";
import {
  createTrigger,
  deleteAlert,
  deleteTrigger,
  describeAudience,
  EVENT_CATALOG,
  fetchAlertsOnce,
  fetchReadReceiptsOnce,
  fetchTriggersOnce,
  fireTrigger,
  SEVERITIES,
  sendAlert,
  setTriggerActive,
  subscribeAlerts,
  subscribeReadReceipts,
  subscribeTriggers,
  type AlertAudience,
  type AlertAudienceType,
  type AlertRecord,
  type TriggerRecord,
} from "@/lib/notifications.firebase";
import type { NotificationSeverity } from "@/lib/demo-store";
import {
  fetchStaffUsersOnce,
  subscribeStaffUsers,
  type StaffUserRecord,
} from "@/lib/auth.firebase";
import { STAFF_ROLES, type StaffRole } from "@/lib/session.functions";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Alerts & Notifications — ForkFleet Console" },
      {
        name: "description",
        content:
          "Compose and broadcast in-app alerts, build event triggers and review delivery in real time.",
      },
      { property: "og:title", content: "Alerts & Notifications — ForkFleet Console" },
      {
        property: "og:description",
        content: "In-app alerts, triggers and the live notification feed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationsPage,
});

const severityTone: Record<NotificationSeverity, string> = {
  info: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  critical: "bg-destructive/15 text-destructive border-destructive/40",
};

const severityDot: Record<NotificationSeverity, string> = {
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
};

const roleLabel = (role: string) => role.replace(/_/g, " ");

const relative = (iso: string | null): string => {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  return formatDistanceToNow(date, { addSuffix: true });
};

function NotificationsPage() {
  return (
    <PermissionGate
      required={["notifications.manage"]}
      breadcrumb={["Platform", "Alerts & notifications"]}
      title="Alerts & notifications"
      description="Broadcast in-app alerts, automate them with triggers and watch delivery live."
    >
      {(staff) => (
        <NotificationsWorkspace
          canManage={staff.hasPermission("notifications.manage")}
          actorEmail={staff.session?.email ?? null}
        />
      )}
    </PermissionGate>
  );
}

/* ------------------------------------------------------------- data plumbing */

function useAlertsData() {
  const queryClient = useQueryClient();
  const alertsQuery = useQuery({ queryKey: ["admin-alerts"], queryFn: fetchAlertsOnce });
  const receiptsQuery = useQuery({
    queryKey: ["alert-read-receipts"],
    queryFn: fetchReadReceiptsOnce,
  });
  const triggersQuery = useQuery({ queryKey: ["alert-triggers"], queryFn: fetchTriggersOnce });
  const usersQuery = useQuery({ queryKey: ["staff-users"], queryFn: fetchStaffUsersOnce });

  useEffect(
    () =>
      subscribeAlerts((rows) => {
        queryClient.setQueryData(["admin-alerts"], rows);
      }),
    [queryClient],
  );
  useEffect(
    () =>
      subscribeReadReceipts((rows) => {
        queryClient.setQueryData(["alert-read-receipts"], rows);
      }),
    [queryClient],
  );
  useEffect(
    () =>
      subscribeTriggers((rows) => {
        queryClient.setQueryData(["alert-triggers"], rows);
      }),
    [queryClient],
  );
  useEffect(
    () =>
      subscribeStaffUsers((rows) => {
        queryClient.setQueryData(["staff-users"], rows);
      }),
    [queryClient],
  );

  return { alertsQuery, receiptsQuery, triggersQuery, usersQuery };
}

/* --------------------------------------------------------------- workspace  */

function NotificationsWorkspace({
  canManage,
  actorEmail,
}: {
  canManage: boolean;
  actorEmail: string | null;
}) {
  const { alertsQuery, receiptsQuery, triggersQuery, usersQuery } = useAlertsData();
  const inbox = useInAppAlerts();

  const [composeOpen, setComposeOpen] = useState(false);
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
  const [deleteAlertTarget, setDeleteAlertTarget] = useState<AlertRecord | null>(null);
  const [deleteTriggerTarget, setDeleteTriggerTarget] = useState<TriggerRecord | null>(null);

  const alerts = alertsQuery.data ?? [];
  const receipts = receiptsQuery.data ?? {};
  const triggers = triggersQuery.data ?? [];
  const users = usersQuery.data ?? [];

  const activeTriggers = triggers.filter((trigger) => trigger.is_active).length;

  const fireMutation = useMutation({
    mutationFn: (input: { id: string }) => fireTrigger({ ...input, actorEmail }),
    onSuccess: (result, input) => {
      if (result.ok) {
        const trigger = triggers.find((entry) => entry.id === input.id);
        toast.success(`"${trigger?.name ?? "Trigger"}" fired — alert delivered to its audience`);
      } else {
        toast.error(result.error);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleTriggerMutation = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      setTriggerActive({ ...input, actorEmail }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error ?? "Failed to update trigger.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (input: { id: string }) => deleteAlert({ ...input, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Alert deleted");
      else toast.error(result.error ?? "Failed to delete alert.");
      setDeleteAlertTarget(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteTriggerMutation = useMutation({
    mutationFn: (input: { id: string }) => deleteTrigger({ ...input, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Trigger deleted");
      else toast.error(result.error ?? "Failed to delete trigger.");
      setDeleteTriggerTarget(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (alertsQuery.isLoading || triggersQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* summary line */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          {alerts.length} alerts sent · {activeTriggers} triggers armed · {inbox.unreadCount} unread
          for you
        </p>
        {canManage && (
          <Button onClick={() => setComposeOpen(true)}>
            <Send className="mr-2 size-4" />
            Send alert
          </Button>
        )}
      </div>

      {/* quick actions — captioned CTAs */}
      <Card>
        <CardContent className="flex flex-wrap items-end justify-center gap-x-8 gap-y-4 py-6">
          {canManage && (
            <>
              <div className="flex flex-col items-center gap-1.5">
                <Button onClick={() => setComposeOpen(true)}>
                  <Send className="mr-2 size-4" />
                  Send alert
                </Button>
                <p className="text-[11px] text-muted-foreground">Lands in the bell instantly</p>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <Button onClick={() => setTriggerDialogOpen(true)}>
                  <Zap className="mr-2 size-4" />
                  Push trigger
                </Button>
                <p className="text-[11px] text-muted-foreground">Fires when its event occurs</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* triggers */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-primary" />
              Triggers
              <Badge variant="outline" className="ml-1 text-[10px]">
                {activeTriggers}/{triggers.length} armed
              </Badge>
            </CardTitle>
            <CardDescription>
              Event-driven automations — dispatch one right now with Send now.
            </CardDescription>
          </div>
          {canManage && (
            <Button
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              aria-label="New trigger"
              title="New trigger"
              onClick={() => setTriggerDialogOpen(true)}
            >
              <Send className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {triggers.map((trigger) => (
            <div
              key={trigger.id}
              className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-opacity ${
                trigger.is_active
                  ? "border-border bg-muted/20"
                  : "border-dashed border-border opacity-60"
              }`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15">
                <Zap
                  className={`size-4 ${trigger.is_active ? "text-primary" : "text-muted-foreground"}`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {trigger.name}
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {trigger.event}
                  </Badge>
                  <span className="flex items-center gap-1 text-xs capitalize text-muted-foreground">
                    <span className={`size-2 rounded-full ${severityDot[trigger.severity]}`} />
                    {describeAudience(trigger.audience)}
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{trigger.title_template}</p>
              </div>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                {trigger.fired_count}× · last {relative(trigger.last_fired_at)}
              </p>
              {canManage ? (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={trigger.is_active}
                    disabled={toggleTriggerMutation.isPending}
                    onCheckedChange={(checked) =>
                      toggleTriggerMutation.mutate({ id: trigger.id, isActive: checked })
                    }
                    aria-label={`Arm or disarm ${trigger.name}`}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                    disabled={fireMutation.isPending || !trigger.is_active}
                    onClick={() => fireMutation.mutate({ id: trigger.id })}
                  >
                    <Send className="mr-1.5 size-3.5" />
                    Send now
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label="Delete trigger"
                    onClick={() => setDeleteTriggerTarget(trigger)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : (
                <Badge variant="outline">{trigger.is_active ? "Armed" : "Off"}</Badge>
              )}
            </div>
          ))}
          {triggers.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
              <Zap className="size-7 text-muted-foreground/50" />
              <p className="text-sm font-medium">No triggers yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Create one to send an alert automatically whenever an event occurs.
              </p>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={() => setTriggerDialogOpen(true)}
                >
                  <Zap className="mr-1.5 size-3.5" />
                  New trigger
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* alerts feed */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4" />
              Recent alerts
              <Badge variant="outline" className="ml-1 text-[10px]">
                {alerts.length}
              </Badge>
            </CardTitle>
            <CardDescription>
              Everything broadcast from this console — read counts update live.
            </CardDescription>
          </div>
          {canManage && (
            <Button
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              aria-label="Send alert"
              title="Send alert"
              onClick={() => setComposeOpen(true)}
            >
              <Send className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {alerts.map((alert) => {
            const readCount = Object.keys(receipts[alert.id] ?? {}).length;
            return (
              <div
                key={alert.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3"
              >
                <span
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${severityDot[alert.severity]}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {alert.title}
                    <Badge
                      variant="outline"
                      className={`${severityTone[alert.severity]} text-[9px] uppercase`}
                    >
                      {alert.severity}
                    </Badge>
                    {alert.source.kind === "trigger" && (
                      <Badge variant="outline" className="gap-1 text-[9px]">
                        <Zap className="size-2.5 text-primary" />
                        {alert.source.trigger_name ?? "Trigger"}
                      </Badge>
                    )}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{alert.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="capitalize">{describeAudience(alert.audience)}</span>·
                    <span>{relative(alert.created_at)}</span>·
                    <span>by {alert.created_by ?? "—"}</span>·
                    <span>{readCount > 0 ? `${readCount} read` : "unread"}</span>
                  </p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Delete alert"
                    onClick={() => setDeleteAlertTarget(alert)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
          {alerts.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
              <Bell className="size-7 text-muted-foreground/50" />
              <p className="text-sm font-medium">No alerts sent yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Compose one — it lands in the recipients&apos; bell instantly.
              </p>
              {canManage && (
                <Button size="sm" className="mt-1" onClick={() => setComposeOpen(true)}>
                  <Send className="mr-1.5 size-3.5" />
                  Send alert
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* my inbox */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-4" />
              My inbox
              {inbox.unreadCount > 0 && (
                <Badge className="border-transparent bg-primary/15 text-primary hover:bg-primary/15">
                  {inbox.unreadCount} unread
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Alerts addressed to you — exactly what the bell shows.
            </CardDescription>
          </div>
          <Button
            size="icon"
            className="size-8 shrink-0 rounded-lg"
            aria-label="Mark all read"
            title="Mark all read"
            onClick={() => void inbox.markAllRead()}
            disabled={inbox.unreadCount === 0}
          >
            <CheckCheck className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {inbox.items.slice(0, 8).map((item) => (
            <button
              key={`${item.source}-${item.id}`}
              type="button"
              onClick={() => void inbox.markRead(item)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60 ${
                item.read_at ? "border-transparent" : "border-primary/25 bg-primary/5"
              }`}
            >
              <span
                className={`mt-1.5 size-2.5 shrink-0 rounded-full ${severityDot[item.severity]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {item.title}
                  {item.trigger_name && (
                    <Badge variant="outline" className="gap-1 text-[9px]">
                      <Zap className="size-2.5 text-primary" />
                      {item.trigger_name}
                    </Badge>
                  )}
                  {!item.read_at && (
                    <Badge className="border-transparent bg-primary/15 text-[9px] text-primary hover:bg-primary/15">
                      new
                    </Badge>
                  )}
                </span>
                <span className="line-clamp-1 block text-xs text-muted-foreground">
                  {item.body}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {relative(item.created_at)} ·{" "}
                  {item.source === "firebase"
                    ? item.trigger_name
                      ? "via trigger"
                      : "live broadcast"
                    : "demo"}
                </span>
              </span>
            </button>
          ))}
          {inbox.items.length > 8 && (
            <p className="pt-1 text-center text-xs text-muted-foreground">
              + {inbox.items.length - 8} more in your bell
            </p>
          )}
          {inbox.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
              <Bell className="size-7 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                You&apos;re all caught up — nothing addressed to you.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <ComposeAlertDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        actorEmail={actorEmail}
        users={users}
      />
      <TriggerDialog
        open={triggerDialogOpen}
        onOpenChange={setTriggerDialogOpen}
        actorEmail={actorEmail}
        users={users}
      />

      <AlertDialog
        open={deleteAlertTarget !== null}
        onOpenChange={(open) => !open && setDeleteAlertTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteAlertTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The alert disappears from every recipient&apos;s inbox and its read receipts are
              cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteAlertTarget) deleteAlertMutation.mutate({ id: deleteAlertTarget.id });
                setDeleteAlertTarget(null);
              }}
            >
              Delete alert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTriggerTarget !== null}
        onOpenChange={(open) => !open && setDeleteTriggerTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTriggerTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The trigger stops firing permanently. Alerts it already sent stay in the feed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTriggerTarget)
                  deleteTriggerMutation.mutate({ id: deleteTriggerTarget.id });
                setDeleteTriggerTarget(null);
              }}
            >
              Delete trigger
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* --------------------------------------------------------- audience picker */

function AudiencePicker({
  audience,
  users,
  onChange,
}: {
  audience: AlertAudience;
  users: StaffUserRecord[];
  onChange: (audience: AlertAudience) => void;
}) {
  const types: { value: AlertAudienceType; label: string }[] = [
    { value: "all", label: "All staff" },
    { value: "roles", label: "Roles" },
    { value: "user", label: "One person" },
  ];

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border border-border p-0.5">
        {types.map((type) => (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange({ ...audience, type: type.value })}
            className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
              audience.type === type.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      {audience.type === "roles" && (
        <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border p-3 sm:grid-cols-3">
          {STAFF_ROLES.map((role: StaffRole) => (
            <label key={role} className="flex cursor-pointer items-center gap-2 text-xs capitalize">
              <Checkbox
                checked={audience.roles.includes(role)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...audience,
                    roles: checked
                      ? [...audience.roles, role]
                      : audience.roles.filter((entry) => entry !== role),
                  })
                }
              />
              {roleLabel(role)}
            </label>
          ))}
        </div>
      )}

      {audience.type === "user" && (
        <Select
          value={audience.user_id ?? ""}
          onValueChange={(value) => {
            const user = users.find((entry) => entry.uid === value);
            onChange({
              ...audience,
              user_id: value,
              user_label: user?.full_name || user?.email || value,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={users.length === 0 ? "No provisioned users yet" : "Choose a team member"}
            />
          </SelectTrigger>
          <SelectContent>
            {users.map((user) => (
              <SelectItem key={user.uid} value={user.uid}>
                {user.full_name || user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ compose alert */

const alertSchema = z.object({
  title: z.string().trim().min(3, "Give the alert a title").max(90),
  body: z.string().trim().min(5, "Write a short message").max(600),
});

function ComposeAlertDialog({
  open,
  onOpenChange,
  actorEmail,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorEmail: string | null;
  users: StaffUserRecord[];
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<NotificationSeverity>("info");
  const [audience, setAudience] = useState<AlertAudience>({
    type: "all",
    roles: [],
    user_id: null,
    user_label: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setSeverity("info");
      setAudience({ type: "all", roles: [], user_id: null, user_label: null });
      setErrors({});
    }
  }, [open]);

  const sendMutation = useMutation({
    mutationFn: () => sendAlert({ title, body, severity, audience, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(`Alert sent to ${describeAudience(audience)}`);
        onOpenChange(false);
      } else {
        setErrors({ title: result.error });
        toast.error(result.error);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = alertSchema.safeParse({ title, body });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    sendMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-5" />
              Send in-app alert
            </DialogTitle>
            <DialogDescription>
              Delivered instantly to the recipients&apos; notification bell — no email needed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="alert-title">Title</Label>
            <Input
              id="alert-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Kitchen 2 closes at 20:00 tonight"
              maxLength={90}
            />
            {errors["title"] && <p className="text-xs text-destructive">{errors["title"]}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alert-body">Message</Label>
            <Textarea
              id="alert-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Plan counter pickups accordingly. Normal hours resume tomorrow."
              rows={3}
              maxLength={600}
            />
            {errors["body"] && <p className="text-xs text-destructive">{errors["body"]}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Severity</Label>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSeverity(option.value)}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                    severity === option.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`size-2 rounded-full ${option.dot}`} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Deliver to</Label>
            <AudiencePicker audience={audience} users={users} onChange={setAudience} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={sendMutation.isPending}>
              {sendMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Send alert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ trigger */

const triggerSchema = z.object({
  name: z.string().trim().min(3, "Name the trigger").max(60),
  titleTemplate: z.string().trim().min(3, "Add a title template").max(90),
  bodyTemplate: z.string().trim().min(5, "Add a body template").max(600),
});

function TriggerDialog({
  open,
  onOpenChange,
  actorEmail,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorEmail: string | null;
  users: StaffUserRecord[];
}) {
  const [name, setName] = useState("");
  const [event, setEvent] = useState(EVENT_CATALOG[0]!.code);
  const [severity, setSeverity] = useState<NotificationSeverity>("warning");
  const [titleTemplate, setTitleTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [audience, setAudience] = useState<AlertAudience>({
    type: "roles",
    roles: ["operations_manager"],
    user_id: null,
    user_label: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setName("");
      setEvent(EVENT_CATALOG[0]!.code);
      setSeverity("warning");
      setTitleTemplate("");
      setBodyTemplate("");
      setAudience({
        type: "roles",
        roles: ["operations_manager"],
        user_id: null,
        user_label: null,
      });
      setErrors({});
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () =>
      createTrigger({
        name,
        event,
        severity,
        titleTemplate,
        bodyTemplate,
        audience,
        actorEmail,
      }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Trigger created and armed");
        onOpenChange(false);
      } else {
        setErrors({ name: result.error ?? "Failed to create trigger." });
        toast.error(result.error);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function applyEventDefaults(code: string) {
    const entry = EVENT_CATALOG.find((candidate) => candidate.code === code);
    setEvent(code);
    if (entry) {
      setSeverity(entry.severity);
      setTitleTemplate(entry.label);
      setBodyTemplate(entry.hint);
    }
  }

  function submit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const parsed = triggerSchema.safeParse({ name, titleTemplate, bodyTemplate });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-5" />
              New event trigger
            </DialogTitle>
            <DialogDescription>
              When the event fires, this alert template is delivered to the audience automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="trigger-name">Trigger name</Label>
            <Input
              id="trigger-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Late orders — ops channel"
              maxLength={60}
            />
            {errors["name"] && <p className="text-xs text-destructive">{errors["name"]}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Event</Label>
            <Select value={event} onValueChange={applyEventDefaults}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_CATALOG.map((entry) => (
                  <SelectItem key={entry.code} value={entry.code}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {EVENT_CATALOG.find((entry) => entry.code === event) && (
              <p className="text-xs text-muted-foreground">
                {EVENT_CATALOG.find((entry) => entry.code === event)?.hint}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Severity</Label>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSeverity(option.value)}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                    severity === option.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`size-2 rounded-full ${option.dot}`} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trigger-title">Alert title</Label>
            <Input
              id="trigger-title"
              value={titleTemplate}
              onChange={(e) => setTitleTemplate(e.target.value)}
              placeholder="Order #{{order_id}} is running late"
              maxLength={90}
            />
            {errors["titleTemplate"] && (
              <p className="text-xs text-destructive">{errors["titleTemplate"]}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trigger-body">Alert body</Label>
            <Textarea
              id="trigger-body"
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              placeholder="{{restaurant}} missed the promised window — guest has been waiting {{minutes}} min."
              rows={3}
              maxLength={600}
            />
            {errors["bodyTemplate"] && (
              <p className="text-xs text-destructive">{errors["bodyTemplate"]}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Deliver to</Label>
            <AudiencePicker audience={audience} users={users} onChange={setAudience} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Zap className="mr-2 size-4" />
              )}
              Create trigger
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
