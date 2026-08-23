import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Ban,
  BadgeCheck,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";

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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createStaffUser,
  fetchStaffUsersOnce,
  generateStaffPassword,
  removeStaffUser,
  sendStaffPasswordReset,
  setStaffUserStatus,
  subscribeStaffUsers,
  updateStaffUserRoles,
  type StaffUserRecord,
} from "@/lib/auth.firebase";
import { RestaurantManagementTab } from "@/components/access/restaurant-management-tab";
import { permissions, rolePermissions } from "@/lib/demo-store";
import { STAFF_ROLES, isStaffRole, type StaffRole } from "@/lib/session.functions";

export const Route = createFileRoute("/_authenticated/access")({
  head: () => ({
    meta: [
      { title: "Access Control — ForkFleet Console" },
      {
        name: "description",
        content:
          "Firebase-backed user provisioning, role assignment and the permission matrix for the operations console.",
      },
      { property: "og:title", content: "Access Control — ForkFleet Console" },
      { property: "og:description", content: "Provision users, grant roles, manage access." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccessPage,
});

/* ------------------------------------------------------------------ catalog */

const ROLE_CATALOG: { role: StaffRole; label: string; blurb: string }[] = [
  { role: "super_admin", label: "Super Admin", blurb: "Unrestricted platform access" },
  { role: "platform_admin", label: "Platform Admin", blurb: "Full platform administration" },
  {
    role: "operations_manager",
    label: "Operations Manager",
    blurb: "Operations across all modules",
  },
  {
    role: "restaurant_owner",
    label: "Restaurant Owner",
    blurb: "Owns restaurants, menus and payouts",
  },
  {
    role: "restaurant_manager",
    label: "Restaurant Manager",
    blurb: "Runs a restaurant day to day",
  },
  { role: "branch_manager", label: "Branch Manager", blurb: "Runs a single branch" },
  { role: "kitchen_manager", label: "Kitchen Manager", blurb: "Kitchen queue and stock" },
  { role: "kitchen_staff", label: "Kitchen Staff", blurb: "Order preparation" },
  { role: "cashier", label: "Cashier", blurb: "Counter orders and promos" },
  { role: "dispatcher", label: "Dispatcher", blurb: "Assigns drivers, manages deliveries" },
  { role: "finance_manager", label: "Finance Manager", blurb: "Payouts, refunds, reporting" },
  { role: "customer_support", label: "Customer Support", blurb: "Tickets, chats, credits" },
  { role: "marketing_manager", label: "Marketing Manager", blurb: "Promotions and campaigns" },
  {
    role: "inventory_manager",
    label: "Inventory Manager",
    blurb: "Stock levels and purchase orders",
  },
  { role: "auditor", label: "Auditor", blurb: "Read-only compliance access" },
];

const roleLabel = (role: StaffRole) =>
  ROLE_CATALOG.find((entry) => entry.role === role)?.label ?? role.replace(/_/g, " ");

const rolePermissionCount = (role: StaffRole) =>
  rolePermissions.filter((rp) => rp.role === role).length;

const AVATAR_COLORS = [
  "bg-sky-500/15 text-sky-400",
  "bg-emerald-500/15 text-emerald-400",
  "bg-amber-500/15 text-amber-400",
  "bg-violet-500/15 text-violet-400",
  "bg-rose-500/15 text-rose-400",
  "bg-cyan-500/15 text-cyan-400",
];

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s.@]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function formatLastLogin(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return formatDistanceToNow(date, { addSuffix: true });
}

/* -------------------------------------------------------------- add user UI */

const addUserSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the staff member's full name").max(80),
  email: z.string().trim().email("Enter a valid work email").max(255),
  jobTitle: z.string().trim().max(80),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .max(72)
    .regex(/[A-Za-z]/, "Include at least one letter")
    .regex(/[0-9]/, "Include at least one number"),
  roles: z
    .array(z.string())
    .min(1, "Grant at least one role so the account can access the console"),
});

function AddUserDialog({
  open,
  onOpenChange,
  actorEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorEmail: string | null;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<StaffUserRecord | null>(null);

  useEffect(() => {
    if (open) {
      setFullName("");
      setEmail("");
      setJobTitle("");
      setPassword(generateStaffPassword());
      setShowPassword(false);
      setRoles(["restaurant_manager"]);
      setErrors({});
      setCreated(null);
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      fullName: string;
      jobTitle: string;
      roles: StaffRole[];
    }) => createStaffUser({ ...input, jobTitle: input.jobTitle || null, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) {
        setCreated(result.user);
      } else {
        setErrors({ email: result.error });
        toast.error(result.error);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggleRole(role: StaffRole, checked: boolean) {
    setRoles((current) =>
      checked ? [...current, role] : current.filter((entry) => entry !== role),
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = addUserSchema.safeParse({ fullName, email, jobTitle, password, roles });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    createMutation.mutate({
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      jobTitle: parsed.data.jobTitle,
      password: parsed.data.password,
      roles: parsed.data.roles.filter(isStaffRole),
    });
  }

  function copy(value: string, label: string) {
    void navigator.clipboard?.writeText(value);
    toast.success(`${label} copied to clipboard`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {created ? (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BadgeCheck className="size-5 text-emerald-500" />
                Team member provisioned
              </DialogTitle>
              <DialogDescription>
                A Firebase Auth account was created and granted access to the console.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Email</span>
                <button
                  type="button"
                  className="flex items-center gap-1.5 font-mono text-xs hover:text-primary"
                  onClick={() => copy(created.email, "Email")}
                >
                  {created.email}
                  <Copy className="size-3" />
                </button>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Temporary password</span>
                <button
                  type="button"
                  className="flex items-center gap-1.5 font-mono text-xs hover:text-primary"
                  onClick={() => copy(password, "Password")}
                >
                  {password}
                  <Copy className="size-3" />
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The user can sign in immediately with these credentials. Share the temporary password
              over a secure channel — they can change it via “Reset password”.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="size-5" />
                Add team member
              </DialogTitle>
              <DialogDescription>
                Registers a Firebase Auth account with email and password, then grants the selected
                roles. No invitation round-trip required.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-full-name">Full name</Label>
                <Input
                  id="add-full-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Thabo Mokoena"
                  autoComplete="off"
                  required
                />
                {errors["fullName"] && (
                  <p className="text-xs text-destructive">{errors["fullName"]}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-job-title">Job title (optional)</Label>
                <Input
                  id="add-job-title"
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  placeholder="Dispatch Lead"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-email">Work email</Label>
              <Input
                id="add-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="thabo@forkfleet.co"
                autoComplete="off"
                required
              />
              {errors["email"] && <p className="text-xs text-destructive">{errors["email"]}</p>}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="add-password">Temporary password</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setPassword(generateStaffPassword());
                    setShowPassword(true);
                  }}
                >
                  <KeyRound className="mr-1 size-3" />
                  Generate strong
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="add-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-10 font-mono text-xs"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors["password"] ? (
                <p className="text-xs text-destructive">{errors["password"]}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Minimum 8 characters with at least one letter and one number.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Grant roles</Label>
              <ScrollArea className="h-52 rounded-md border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {ROLE_CATALOG.map((entry) => (
                    <label
                      key={entry.role}
                      className="flex cursor-pointer items-start gap-2 rounded-md p-2 transition-colors hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={roles.includes(entry.role)}
                        onCheckedChange={(checked) => toggleRole(entry.role, checked === true)}
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium leading-none">
                          {entry.label}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {entry.blurb} · {rolePermissionCount(entry.role)} permissions
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
              {errors["roles"] && <p className="text-xs text-destructive">{errors["roles"]}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- workspace  */

type StaffHook = ReturnType<typeof import("@/hooks/use-staff-session").useStaffSession>;

function AccessWorkspace({ staff }: { staff: StaffHook }) {
  const queryClient = useQueryClient();
  const canManage = staff.hasPermission("users.manage");
  const currentUid = staff.session?.userId;
  const currentEmail = staff.session?.email ?? null;

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<StaffUserRecord | null>(null);

  const usersQuery = useQuery({
    queryKey: ["staff-users"],
    queryFn: fetchStaffUsersOnce,
  });

  // Real-time staff list — provisioned, suspended or removed users update instantly.
  useEffect(() => {
    return subscribeStaffUsers((rows) => queryClient.setQueryData(["staff-users"], rows));
  }, [queryClient]);

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      [user.full_name, user.email, user.job_title ?? "", ...user.roles.map(roleLabel)]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [users, search]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["staff-users"] });
  const onError = (error: Error) => toast.error(error.message);

  const rolesMutation = useMutation({
    mutationFn: (input: { uid: string; roles: StaffRole[] }) =>
      updateStaffUserRoles({ ...input, actorEmail: currentEmail }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Roles updated — applies on the user's next session refresh");
      else toast.error(result.error ?? "Failed to update roles");
      void invalidate();
    },
    onError,
  });

  const statusMutation = useMutation({
    mutationFn: (input: { uid: string; status: "active" | "suspended" }) =>
      setStaffUserStatus({ ...input, actorEmail: currentEmail }),
    onSuccess: (result, input) => {
      if (result.ok) {
        toast.success(
          input.status === "suspended"
            ? "Account suspended — sign-in is now blocked"
            : "Account reactivated",
        );
      } else {
        toast.error(result.error ?? "Failed to update status");
      }
      void invalidate();
    },
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: (input: { uid: string }) => removeStaffUser({ ...input, actorEmail: currentEmail }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Access revoked — the account can no longer sign in");
      else toast.error(result.error ?? "Failed to remove user");
      void invalidate();
    },
    onError,
  });

  const resetMutation = useMutation({
    mutationFn: (input: { email: string }) =>
      sendStaffPasswordReset({ ...input, actorEmail: currentEmail }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Password reset email sent");
      else toast.error(result.error ?? "Failed to send reset email");
    },
    onError,
  });

  const stats = {
    total: users.length,
    active: users.filter((user) => user.status === "active").length,
    suspended: users.filter((user) => user.status === "suspended").length,
    rolesInUse: new Set(users.flatMap((user) => user.roles)).size,
  };

  const connection = usersQuery.isError ? "offline" : "live";

  if (usersQuery.isLoading) {
    return (
      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="restaurant-management">Restaurant Management</TabsTrigger>
          <TabsTrigger value="matrix">Permission matrix</TabsTrigger>
        </TabsList>
        <div className="mt-4 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </Tabs>
    );
  }

  return (
    <Tabs defaultValue="team">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="restaurant-management">Restaurant Management</TabsTrigger>
          <TabsTrigger value="matrix">Permission matrix</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 font-normal">
            {connection === "live" ? (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <Wifi className="size-3 text-emerald-500" />
                Firebase live
              </>
            ) : (
              <>
                <WifiOff className="size-3 text-amber-500" />
                Offline
              </>
            )}
          </Badge>
          {canManage && (
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-2 size-4" />
              Add user
            </Button>
          )}
        </div>
      </div>

      <TabsContent value="team" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Team members", value: stats.total, icon: Users },
            { label: "Active", value: stats.active, icon: BadgeCheck },
            { label: "Suspended", value: stats.suspended, icon: Ban },
            {
              label: "Roles in use",
              value: `${stats.rolesInUse} / ${STAFF_ROLES.length}`,
              icon: ShieldCheck,
            },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
                </div>
                <stat.icon className="size-8 text-muted-foreground/50" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Staff &amp; roles
            </CardTitle>
            <CardDescription>
              Firebase Auth accounts provisioned for this console. Role changes apply on the user's
              next session refresh.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, email, job title or role…"
                className="pl-8"
              />
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Job title</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((member) => {
                    const self = member.uid === currentUid;
                    const missingRoles = ROLE_CATALOG.filter(
                      (entry) => !member.roles.includes(entry.role),
                    );
                    return (
                      <TableRow key={member.uid}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-8">
                              <AvatarFallback
                                className={`text-xs font-semibold ${avatarColor(member.uid)}`}
                              >
                                {initialsOf(member.full_name, member.email)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 truncate text-sm font-medium">
                                {member.full_name || member.email}
                                {self && (
                                  <Badge variant="outline" className="text-[10px]">
                                    You
                                  </Badge>
                                )}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {member.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {member.job_title ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex max-w-md flex-wrap items-center gap-1">
                            {member.roles.map((role) => (
                              <Badge key={role} variant="secondary" className="gap-1">
                                {roleLabel(role)}
                                {canManage && !self && (
                                  <button
                                    type="button"
                                    aria-label={`Revoke ${roleLabel(role)}`}
                                    className="opacity-60 transition-opacity hover:opacity-100"
                                    disabled={rolesMutation.isPending}
                                    onClick={() =>
                                      rolesMutation.mutate({
                                        uid: member.uid,
                                        roles: member.roles.filter((entry) => entry !== role),
                                      })
                                    }
                                  >
                                    ✕
                                  </button>
                                )}
                              </Badge>
                            ))}
                            {member.roles.length === 0 && (
                              <Badge variant="outline" className="text-muted-foreground">
                                No role
                              </Badge>
                            )}
                            {canManage && !self && missingRoles.length > 0 && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 gap-1 px-2 text-[11px]"
                                    disabled={rolesMutation.isPending}
                                  >
                                    <Plus className="size-3" />
                                    Role
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-56">
                                  <DropdownMenuLabel>Grant role</DropdownMenuLabel>
                                  {missingRoles.map((entry) => (
                                    <DropdownMenuItem
                                      key={entry.role}
                                      onSelect={(event) => {
                                        event.preventDefault();
                                        rolesMutation.mutate({
                                          uid: member.uid,
                                          roles: [...member.roles, entry.role],
                                        });
                                      }}
                                    >
                                      <div className="flex w-full items-center justify-between gap-2">
                                        <span>{entry.label}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {rolePermissionCount(entry.role)} perms
                                        </span>
                                      </div>
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {member.status === "active" ? (
                            <Badge className="border-transparent bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Suspended</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatLastLogin(member.last_login_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && !self ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-8">
                                  <MoreHorizontal className="size-4" />
                                  <span className="sr-only">Open member actions</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuItem
                                  onSelect={() => void navigator.clipboard?.writeText(member.email)}
                                >
                                  <Copy className="mr-2 size-4" />
                                  Copy email
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => resetMutation.mutate({ email: member.email })}
                                >
                                  <KeyRound className="mr-2 size-4" />
                                  Send password reset
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {member.status === "active" ? (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      statusMutation.mutate({
                                        uid: member.uid,
                                        status: "suspended",
                                      })
                                    }
                                  >
                                    <Ban className="mr-2 size-4" />
                                    Suspend access
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      statusMutation.mutate({ uid: member.uid, status: "active" })
                                    }
                                  >
                                    <BadgeCheck className="mr-2 size-4" />
                                    Reactivate access
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    setPendingRemove(member);
                                  }}
                                >
                                  <Trash2 className="mr-2 size-4" />
                                  Remove from console
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {self ? "Your account" : ""}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Users className="size-8 text-muted-foreground/50" />
                          <p className="text-sm font-medium">No team members found</p>
                          <p className="max-w-sm text-xs text-muted-foreground">
                            {users.length === 0
                              ? "Provision your first console user — a real Firebase Auth account with email and password."
                              : "Try a different search term."}
                          </p>
                          {canManage && users.length === 0 && (
                            <Button size="sm" className="mt-1" onClick={() => setAddOpen(true)}>
                              <UserPlus className="mr-2 size-4" />
                              Add user
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="restaurant-management">
        <RestaurantManagementTab canManage={canManage} actorEmail={currentEmail} />
      </TabsContent>

      <TabsContent value="matrix">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Permission matrix</CardTitle>
            <CardDescription>
              {permissions.length} permissions across the platform, grouped by module. Roles are
              granted per user in the Team tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {Array.from(
              permissions.reduce((map, permission) => {
                const list = map.get(permission.module) ?? [];
                list.push(permission);
                map.set(permission.module, list);
                return map;
              }, new Map<string, typeof permissions>()),
            ).map(([module, modulePermissions]) => (
              <div key={module} className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold capitalize">{module}</p>
                  <Badge variant="outline" className="text-[10px]">
                    {modulePermissions.length} permission{modulePermissions.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Permission</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Granted to</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modulePermissions.map((permission) => (
                        <TableRow key={permission.code}>
                          <TableCell className="font-mono text-xs">{permission.code}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {permission.description}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {rolePermissions
                                .filter((rp) => rp.permission_code === permission.code)
                                .map((rp) => (
                                  <Badge key={rp.role} variant="outline" className="text-[10px]">
                                    {roleLabel(rp.role as StaffRole)}
                                  </Badge>
                                ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} actorEmail={currentEmail} />

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingRemove?.full_name || pendingRemove?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their console access is revoked immediately and they can no longer sign in. The
              underlying Firebase Auth record is kept — an administrator can re-provision it later
              from the Firebase Console if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingRemove) removeMutation.mutate({ uid: pendingRemove.uid });
                setPendingRemove(null);
              }}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}

function AccessPage() {
  return (
    <PermissionGate
      required={["users.view", "users.manage"]}
      breadcrumb={["Platform", "Access control"]}
      title="Access control"
      description="Provision Firebase Auth users, grant roles and audit platform access — live from the database."
    >
      {(staff) => <AccessWorkspace staff={staff} />}
    </PermissionGate>
  );
}
