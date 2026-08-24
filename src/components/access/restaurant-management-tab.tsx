import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Ban,
  BadgeCheck,
  ChevronDown,
  Copy,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FirebaseSessionBanner } from "@/components/access/firebase-session-banner";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";
import {
  getDefaultPermissionsForRole,
  RESTAURANT_PERMISSIONS,
  restaurantRoleLabel,
  type RestaurantRole,
} from "@/lib/restaurant-permissions";
import {
  createRestaurantUser,
  fetchRestaurantUsersOnce,
  generateRestaurantUserPassword,
  removeRestaurantUser,
  sendRestaurantUserPasswordReset,
  setRestaurantUserStatus,
  subscribeRestaurantUsers,
  updateRestaurantUserAssignment,
  updateRestaurantUserPermissions,
  updateRestaurantUserProfile,
  type RestaurantUserRecord,
} from "@/lib/restaurant-users.firebase";

const ROLE_CATALOG: { role: RestaurantRole; label: string; blurb: string }[] = [
  { role: "restaurant_owner", label: "Restaurant Owner", blurb: "Full access to all restaurant modules" },
  { role: "restaurant_manager", label: "Restaurant Manager", blurb: "Day-to-day operations and staff oversight" },
  { role: "branch_manager", label: "Branch Manager", blurb: "Manages a single branch location" },
  { role: "kitchen_manager", label: "Kitchen Manager", blurb: "Kitchen queue, menu and inventory" },
  { role: "kitchen_staff", label: "Kitchen Staff", blurb: "Order preparation only" },
  { role: "cashier", label: "Cashier", blurb: "Counter orders, tables and customers" },
  { role: "inventory_manager", label: "Inventory Manager", blurb: "Stock levels and purchasing" },
];

const AVATAR_COLORS = [
  "bg-sky-500/15 text-sky-400",
  "bg-emerald-500/15 text-emerald-400",
  "bg-amber-500/15 text-amber-400",
  "bg-violet-500/15 text-violet-400",
  "bg-rose-500/15 text-rose-400",
  "bg-cyan-500/15 text-cyan-400",
];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

const addUserSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the user's full name").max(80),
  email: z.string().trim().email("Enter a valid email").max(255),
  jobTitle: z.string().trim().max(80),
  phone: z.string().trim().max(30),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .max(72)
    .regex(/[A-Za-z]/, "Include at least one letter")
    .regex(/[0-9]/, "Include at least one number"),
  restaurantId: z.string().min(1, "Select a restaurant"),
  role: z.string().min(1, "Select a role"),
  permissions: z.array(z.string()).min(1, "Grant at least one permission"),
});

function initialsOf(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s.@]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function formatLastLogin(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return formatDistanceToNow(date, { addSuffix: true });
}

function PermissionPicker({
  permissions,
  onChange,
  role,
}: {
  permissions: string[];
  onChange: (codes: string[]) => void;
  role: RestaurantRole;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof RESTAURANT_PERMISSIONS>();
    for (const perm of RESTAURANT_PERMISSIONS) {
      const list = map.get(perm.module) ?? [];
      list.push(perm);
      map.set(perm.module, list);
    }
    return map;
  }, []);

  const defaults = getDefaultPermissionsForRole(role);

  function applyRoleDefaults() {
    onChange(defaults);
  }

  function toggleModule(modulePerms: typeof RESTAURANT_PERMISSIONS, checked: boolean) {
    const codes = modulePerms.map((p) => p.code);
    if (checked) {
      onChange([...new Set([...permissions, ...codes])]);
    } else {
      onChange(permissions.filter((code) => !codes.includes(code)));
    }
  }

  function toggle(code: string, checked: boolean) {
    onChange(checked ? [...permissions, code] : permissions.filter((entry) => entry !== code));
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label className="text-sm font-semibold">Module access</Label>
          <p className="text-xs text-muted-foreground">
            {permissions.length} of {RESTAURANT_PERMISSIONS.length} permissions selected
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={applyRoleDefaults}>
          Apply {restaurantRoleLabel(role)} defaults
        </Button>
      </div>
      <ScrollArea className="h-56 pr-3">
        <div className="space-y-2">
          {Array.from(grouped.entries()).map(([module, modulePermissions]) => {
            const selectedCount = modulePermissions.filter((p) => permissions.includes(p.code)).length;
            const allSelected = selectedCount === modulePermissions.length;
            return (
              <Collapsible key={module} defaultOpen={selectedCount > 0}>
                <div className="rounded-md border border-border/60 bg-background">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
                      <span className="text-sm font-medium capitalize">{module}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {selectedCount}/{modulePermissions.length}
                      </Badge>
                    </div>
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => toggleModule(modulePermissions, checked === true)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Toggle all ${module} permissions`}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 border-t border-border/60 px-3 py-2">
                    {modulePermissions.map((perm) => (
                      <label
                        key={perm.code}
                        className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={permissions.includes(perm.code)}
                          onCheckedChange={(checked) => toggle(perm.code, checked === true)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-sm leading-none">{perm.description}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {perm.actions.join(" · ")}
                          </span>
                        </span>
                      </label>
                    ))}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function AddRestaurantUserDialog({
  open,
  onOpenChange,
  actorEmail,
  restaurants,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorEmail: string | null;
  restaurants: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [restaurantId, setRestaurantId] = useState("");
  const [role, setRole] = useState<RestaurantRole>("restaurant_owner");
  const [permissions, setPermissions] = useState<string[]>(
    getDefaultPermissionsForRole("restaurant_owner"),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<RestaurantUserRecord | null>(null);

  useEffect(() => {
    if (open) {
      setFullName("");
      setEmail("");
      setJobTitle("");
      setPhone("");
      setPassword(generateRestaurantUserPassword());
      setShowPassword(false);
      setRestaurantId(restaurants[0]?.id ?? "");
      setRole("restaurant_owner");
      setPermissions(getDefaultPermissionsForRole("restaurant_owner"));
      setErrors({});
      setFormError(null);
      setCreated(null);
    }
  }, [open, restaurants]);

  useEffect(() => {
    setPermissions(getDefaultPermissionsForRole(role));
  }, [role]);

  const createMutation = useMutation({
    mutationFn: createRestaurantUser,
    onSuccess: (result) => {
      if (result.ok) {
        setCreated(result.user);
        onCreated();
      } else {
        setFormError(result.error);
        if (result.error.toLowerCase().includes("email")) {
          setErrors({ email: result.error });
        }
        toast.error(result.error);
      }
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast.error(error.message);
    },
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!restaurantId) {
      setErrors({ restaurantId: "Select a restaurant" });
      return;
    }
    const parsed = addUserSchema.safeParse({
      fullName,
      email,
      jobTitle,
      phone,
      password,
      restaurantId,
      role,
      permissions,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    createMutation.mutate({
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      jobTitle: parsed.data.jobTitle || null,
      phone: parsed.data.phone || null,
      password: parsed.data.password,
      restaurantId: parsed.data.restaurantId,
      role: parsed.data.role as RestaurantRole,
      permissions: parsed.data.permissions,
      actorEmail,
    });
  }

  function copy(value: string, label: string) {
    void navigator.clipboard?.writeText(value);
    toast.success(`${label} copied to clipboard`);
  }

  const restaurantName = restaurants.find((r) => r.id === created?.restaurant_id)?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {created ? (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BadgeCheck className="size-5 text-emerald-500" />
                Account ready
              </DialogTitle>
              <DialogDescription>
                {created.full_name || created.email} can now sign in to the Restaurant Management
                application.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <button
                    type="button"
                    className="mt-0.5 flex items-center gap-1.5 font-mono text-xs hover:text-primary"
                    onClick={() => copy(created.email, "Email")}
                  >
                    {created.email}
                    <Copy className="size-3" />
                  </button>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Role</p>
                  <p className="mt-0.5 text-sm font-medium">{restaurantRoleLabel(created.role)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Restaurant</p>
                  <p className="mt-0.5 text-sm font-medium">
                    {restaurantName ?? created.restaurant_id}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Permissions</p>
                  <p className="mt-0.5 text-sm font-medium">{created.permissions.length} modules</p>
                </div>
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
              Share credentials over a secure channel. The user should change their password after
              first sign-in.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="size-5" />
                Provision Restaurant Management user
              </DialogTitle>
              <DialogDescription>
                Creates a Firebase Auth account, assigns one restaurant, and grants module
                permissions. The user cannot switch restaurants after sign-in.
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <Alert variant="destructive">
                <AlertTitle>Could not create user</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {restaurants.length === 0 && (
              <Alert>
                <Store className="size-4" />
                <AlertTitle>No restaurants available</AlertTitle>
                <AlertDescription>
                  Add at least one restaurant under Restaurants before provisioning users.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Profile
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rm-full-name">Full name</Label>
                  <Input
                    id="rm-full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Thabo Mokoena"
                    autoComplete="name"
                    required
                  />
                  {errors["fullName"] && (
                    <p className="text-xs text-destructive">{errors["fullName"]}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rm-job-title">Job title (optional)</Label>
                  <Input
                    id="rm-job-title"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="Restaurant Owner"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rm-email">Work email</Label>
                  <Input
                    id="rm-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@restaurant.co"
                    autoComplete="off"
                    required
                  />
                  {errors["email"] && <p className="text-xs text-destructive">{errors["email"]}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rm-phone">Phone (optional)</Label>
                  <Input
                    id="rm-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+27 82 123 4567"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Restaurant assignment
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Assigned restaurant</Label>
                  <Select
                    {...(restaurantId ? { value: restaurantId } : {})}
                    onValueChange={setRestaurantId}
                    disabled={restaurants.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select restaurant" />
                    </SelectTrigger>
                    <SelectContent>
                      {restaurants.map((restaurant) => (
                        <SelectItem key={restaurant.id} value={restaurant.id}>
                          {restaurant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors["restaurantId"] && (
                    <p className="text-xs text-destructive">{errors["restaurantId"]}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(value) => setRole(value as RestaurantRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_CATALOG.map((entry) => (
                        <SelectItem key={entry.role} value={entry.role}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_CATALOG.find((entry) => entry.role === role)?.blurb}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Credentials
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="rm-password">Temporary password</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setPassword(generateRestaurantUserPassword());
                      setShowPassword(true);
                    }}
                  >
                    <KeyRound className="mr-1 size-3" />
                    Generate strong
                  </Button>
                </div>
                <div className="relative">
                  <Input
                    id="rm-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                {errors["password"] && (
                  <p className="text-xs text-destructive">{errors["password"]}</p>
                )}
              </div>
            </div>

            <PermissionPicker permissions={permissions} onChange={setPermissions} role={role} />
            {errors["permissions"] && (
              <p className="text-xs text-destructive">{errors["permissions"]}</p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || restaurants.length === 0 || !restaurantId}
              >
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

function EditRestaurantUserDialog({
  user,
  open,
  onOpenChange,
  actorEmail,
  restaurants,
}: {
  user: RestaurantUserRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorEmail: string | null;
  restaurants: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [role, setRole] = useState<RestaurantRole>("restaurant_manager");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [tab, setTab] = useState<"profile" | "assignment" | "permissions">("profile");

  useEffect(() => {
    if (user && open) {
      setFullName(user.full_name);
      setJobTitle(user.job_title ?? "");
      setPhone(user.phone ?? "");
      setRestaurantId(user.restaurant_id);
      setRole(user.role);
      setPermissions(user.permissions);
      setTab("profile");
    }
  }, [user, open]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["restaurant-users"] });

  const profileMutation = useMutation({
    mutationFn: updateRestaurantUserProfile,
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Profile updated");
        void invalidate();
        onOpenChange(false);
      } else toast.error(result.error ?? "Failed to update profile");
    },
  });

  const assignmentMutation = useMutation({
    mutationFn: updateRestaurantUserAssignment,
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Restaurant assignment updated");
        void invalidate();
        onOpenChange(false);
      } else toast.error(result.error ?? "Failed to update assignment");
    },
  });

  const permissionsMutation = useMutation({
    mutationFn: updateRestaurantUserPermissions,
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Permissions updated");
        void invalidate();
        onOpenChange(false);
      } else toast.error(result.error ?? "Failed to update permissions");
    },
  });

  if (!user) return null;

  function save() {
    if (tab === "profile") {
      profileMutation.mutate({
        uid: user!.uid,
        fullName,
        jobTitle: jobTitle || null,
        phone: phone || null,
        actorEmail,
      });
    } else if (tab === "assignment") {
      assignmentMutation.mutate({
        uid: user!.uid,
        restaurantId,
        role,
        actorEmail,
      });
    } else {
      permissionsMutation.mutate({
        uid: user!.uid,
        permissions,
        actorEmail,
      });
    }
  }

  const pending =
    profileMutation.isPending || assignmentMutation.isPending || permissionsMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {user.full_name || user.email}</DialogTitle>
          <DialogDescription>
            Update profile, restaurant assignment, role or module permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          {(["profile", "assignment", "permissions"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={tab === value ? "default" : "outline"}
              onClick={() => setTab(value)}
            >
              {value === "profile" ? "Profile" : value === "assignment" ? "Assignment" : "Permissions"}
            </Button>
          ))}
        </div>

        {tab === "profile" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Job title</Label>
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Email: {user.email} (cannot be changed here)</p>
          </div>
        )}

        {tab === "assignment" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Assigned restaurant</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {restaurants.map((restaurant) => (
                    <SelectItem key={restaurant.id} value={restaurant.id}>
                      {restaurant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Each user belongs to exactly one restaurant. Assignment is controlled by Super Admin.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as RestaurantRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_CATALOG.map((entry) => (
                    <SelectItem key={entry.role} value={entry.role}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {tab === "permissions" && (
          <PermissionPicker permissions={permissions} onChange={setPermissions} role={role} />
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RestaurantManagementTab({
  canManage,
  actorEmail,
}: {
  canManage: boolean;
  actorEmail: string | null;
}) {
  const queryClient = useQueryClient();
  const { rows: restaurants, loading: restaurantsLoading } = useFirebaseRestaurants();
  const restaurantOptions = useMemo(
    () => restaurants.map((r) => ({ id: r.id, name: r.name })),
    [restaurants],
  );
  const restaurantNames = useMemo(
    () => Object.fromEntries(restaurants.map((r) => [r.id, r.name])),
    [restaurants],
  );

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<RestaurantUserRecord | null>(null);
  const [pendingRemove, setPendingRemove] = useState<RestaurantUserRecord | null>(null);

  const usersQuery = useQuery({
    queryKey: ["restaurant-users"],
    queryFn: fetchRestaurantUsersOnce,
  });

  useEffect(() => {
    return subscribeRestaurantUsers((rows) =>
      queryClient.setQueryData(["restaurant-users"], rows),
    );
  }, [queryClient]);

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      [
        user.full_name,
        user.email,
        user.job_title ?? "",
        restaurantNames[user.restaurant_id] ?? "",
        restaurantRoleLabel(user.role),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [users, search, restaurantNames]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["restaurant-users"] });
  const onError = (error: Error) => toast.error(error.message);

  const statusMutation = useMutation({
    mutationFn: setRestaurantUserStatus,
    onSuccess: (result, input) => {
      if (result.ok) {
        toast.success(
          input.status === "suspended" ? "User deactivated" : "User reactivated",
        );
      } else toast.error(result.error ?? "Failed to update status");
      void invalidate();
    },
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: removeRestaurantUser,
    onSuccess: (result) => {
      if (result.ok) toast.success("Restaurant Management access revoked");
      else toast.error(result.error ?? "Failed to remove user");
      void invalidate();
    },
    onError,
  });

  const resetMutation = useMutation({
    mutationFn: sendRestaurantUserPasswordReset,
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
    restaurants: new Set(users.map((user) => user.restaurant_id)).size,
  };

  if (usersQuery.isLoading || restaurantsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canManage && <FirebaseSessionBanner />}

      {usersQuery.isError && (
        <Alert variant="destructive">
          <WifiOff className="size-4" />
          <AlertTitle>Could not load Restaurant Management users</AlertTitle>
          <AlertDescription>
            {(usersQuery.error as Error | null)?.message ??
              "The user list could not be read from Firebase."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Crown className="size-4 text-amber-500" />
            <h3 className="text-base font-semibold">Restaurant Management access</h3>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Provision owners, managers and staff who will sign in to the separate Restaurant
            Management application. Each user is locked to one restaurant.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1.5 font-normal">
            {usersQuery.isError ? (
              <>
                <WifiOff className="size-3 text-amber-500" />
                Offline
              </>
            ) : (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <Wifi className="size-3 text-emerald-500" />
                Firebase live
              </>
            )}
          </Badge>
          {canManage && (
            <Button onClick={() => setAddOpen(true)} disabled={restaurantOptions.length === 0}>
              <UserPlus className="mr-2 size-4" />
              Add user
            </Button>
          )}
        </div>
      </div>

      {restaurantOptions.length === 0 && (
        <Alert>
          <Store className="size-4" />
          <AlertTitle>No restaurants in Firebase</AlertTitle>
          <AlertDescription>
            Create restaurants first under the Restaurants section, then return here to assign
            owners and managers.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Restaurant users", value: stats.total, icon: Users },
          { label: "Active", value: stats.active, icon: BadgeCheck },
          { label: "Deactivated", value: stats.suspended, icon: Ban },
          { label: "Restaurants covered", value: stats.restaurants, icon: Store },
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
            <ShieldCheck className="size-4" /> Restaurant Management users
          </CardTitle>
          <CardDescription>
            Each user is linked to one restaurant with a role and module permissions. Firebase Auth
            accounts are shared with the Restaurant Management application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, restaurant or role…"
              className="pl-8"
            />
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Restaurant</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((member) => (
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
                          <p className="truncate text-sm font-medium">
                            {member.full_name || member.email}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Store className="size-3.5 text-muted-foreground" />
                        <span className="text-sm">
                          {restaurantNames[member.restaurant_id] ?? member.restaurant_id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={member.role === "restaurant_owner" ? "default" : "secondary"}
                        className="gap-1"
                      >
                        {member.role === "restaurant_owner" && <Crown className="size-3" />}
                        {restaurantRoleLabel(member.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] tabular-nums">
                        {member.permissions.length} granted
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {member.status === "active" ? (
                        <Badge className="border-transparent bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Deactivated</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatLastLogin(member.last_login_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => setEditUser(member)}>
                              <Pencil className="mr-2 size-4" />
                              Edit user
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void navigator.clipboard?.writeText(member.email)}
                            >
                              <Copy className="mr-2 size-4" />
                              Copy email
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => resetMutation.mutate({ email: member.email, actorEmail })}
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
                                    actorEmail,
                                  })
                                }
                              >
                                <Ban className="mr-2 size-4" />
                                Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onSelect={() =>
                                  statusMutation.mutate({
                                    uid: member.uid,
                                    status: "active",
                                    actorEmail,
                                  })
                                }
                              >
                                <BadgeCheck className="mr-2 size-4" />
                                Reactivate
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
                              Remove access
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="size-8 text-muted-foreground/50" />
                        <p className="text-sm font-medium">No Restaurant Management users</p>
                        <p className="max-w-sm text-xs text-muted-foreground">
                          {users.length === 0
                            ? "Create the first user — a real Firebase Auth account assigned to one restaurant."
                            : "Try a different search term."}
                        </p>
                        {canManage && users.length === 0 && restaurantOptions.length > 0 && (
                          <Button size="sm" className="mt-1" onClick={() => setAddOpen(true)}>
                            <Plus className="mr-2 size-4" />
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

      <AddRestaurantUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        actorEmail={actorEmail}
        restaurants={restaurantOptions}
        onCreated={() => void invalidate()}
      />

      <EditRestaurantUserDialog
        user={editUser}
        open={editUser !== null}
        onOpenChange={(open) => {
          if (!open) setEditUser(null);
        }}
        actorEmail={actorEmail}
        restaurants={restaurantOptions}
      />

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
              Their Restaurant Management access is revoked immediately. The Firebase Auth record is
              kept for audit purposes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingRemove) removeMutation.mutate({ uid: pendingRemove.uid, actorEmail });
                setPendingRemove(null);
              }}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
