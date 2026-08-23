import { Fragment, useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Search, Sun, Bell, CheckCheck, Loader2 } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/hooks/use-theme";
import { useServerFn } from "@/lib/use-demo-fn";
import { useStaffSession } from "@/hooks/use-staff-session";
import { useInAppAlerts } from "@/hooks/use-in-app-alerts";
import { signOutDemo, isDemoSignedIn } from "@/lib/session.functions";
import { useFirebaseOrderSync } from "@/hooks/use-firebase-orders";

const roleLabel = (role: string) => role.replace(/_/g, " ");
const severityTone: Record<string, string> = {
  info: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  critical: "bg-destructive/15 text-destructive border-destructive/40",
};

function HeaderShellSkeleton() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-3 backdrop-blur">
      <Skeleton className="h-7 w-7 rounded-md" />
      <Skeleton className="hidden h-9 max-w-sm flex-1 rounded-md md:block" />
      <div className="ml-auto flex items-center gap-1.5">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
    </header>
  );
}

function SidebarSkeleton() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="size-8 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-2.5 w-28 rounded" />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <div className="space-y-4 p-3">
          {["Operations", "Catalogue", "Commerce", "Platform"].map((label) => (
            <div key={label} className="space-y-2">
              <Skeleton className="h-3 w-20 rounded" />
              {Array.from({
                length:
                  label === "Operations"
                    ? 6
                    : label === "Catalogue"
                      ? 3
                      : label === "Commerce"
                        ? 2
                        : 2,
              }).map((_, i) => (
                <Skeleton key={`${label}-${i}`} className="h-8 w-full rounded-md" />
              ))}
            </div>
          ))}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}

export function AppShell({
  breadcrumb,
  title,
  description,
  actions,
  children,
}: {
  breadcrumb: string[];
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const staff = useStaffSession();
  const session = staff.session;
  useFirebaseOrderSync();

  // Redirect to /auth if we're definitely signed out (only after the query settles)
  useEffect(() => {
    if (!staff.isLoading && !staff.isFetching && !isDemoSignedIn()) {
      void navigate({ to: "/auth", replace: true });
    }
  }, [staff.isLoading, staff.isFetching, navigate]);

  const alerts = useInAppAlerts();
  const unreadCount = alerts.unreadCount;

  const initials = (session?.fullName ?? session?.email ?? "OP")
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  async function signOut() {
    await queryClient.cancelQueries();
    signOutDemo();
    queryClient.clear();
    navigate({ to: "/auth", replace: true });
  }

  async function openNotification(id: string, link?: string | null) {
    const item = alerts.items.find((entry) => entry.id === id);
    if (item) void alerts.markRead(item);
    if (link) void navigate({ to: link as never });
  }

  async function readAll() {
    await alerts.markAllRead();
  }

  const loading = !session;
  const permissions = session?.permissions ?? [];

  return (
    <SidebarProvider defaultOpen={true}>
      {loading ? <SidebarSkeleton /> : <AppSidebar permissions={permissions} />}

      <SidebarInset className="min-w-0">
        {loading ? (
          <HeaderShellSkeleton />
        ) : (
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/65">
            <SidebarTrigger aria-label="Toggle navigation" />
            <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />

            <nav aria-label="Breadcrumb" className="hidden min-w-0 lg:block">
              <Breadcrumb>
                <BreadcrumbList className="flex-nowrap">
                  {breadcrumb.map((crumb, index) => (
                    <Fragment key={crumb}>
                      <BreadcrumbItem className="min-w-0">
                        <BreadcrumbPage
                          className={`truncate ${index === breadcrumb.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}`}
                        >
                          {crumb}
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                      {index < breadcrumb.length - 1 && <BreadcrumbSeparator />}
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            </nav>

            <div className="relative ml-auto hidden w-full max-w-xs md:block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search orders, restaurants, drivers…"
                className="h-9 bg-surface pl-8 pr-12"
                aria-label="Global search"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground lg:block">
                /
              </kbd>
            </div>

            <div className="ml-auto flex items-center gap-1 md:ml-2">
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search">
                <Search className="size-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
                    className="relative"
                  >
                    <Bell className="size-4" />
                    {unreadCount > 0 && (
                      <Badge className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full p-0 text-[9px] tabular-nums">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[22rem] p-0">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium leading-none">In-app alerts</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={readAll}
                      disabled={unreadCount === 0}
                    >
                      <CheckCheck className="mr-1 size-3.5" /> Mark all read
                    </Button>
                  </div>
                  <ScrollArea className="max-h-80">
                    {alerts.items.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 p-8 text-center">
                        <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                          <Bell className="size-4 text-muted-foreground" />
                        </span>
                        <p className="text-xs text-muted-foreground">No alerts yet.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {alerts.items.slice(0, 12).map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => void openNotification(n.id, n.link)}
                            className={`flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/60 ${!n.read_at ? "bg-accent/25" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="min-w-0 font-medium leading-snug">{n.title}</span>
                              <Badge
                                variant="outline"
                                className={`${severityTone[n.severity]} shrink-0 text-[9px] uppercase`}
                              >
                                {n.severity}
                              </Badge>
                            </div>
                            <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(n.created_at).toLocaleString()}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="border-t border-border p-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => navigate({ to: "/notifications" })}
                    >
                      Manage notification triggers
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
              <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-9 max-w-[12rem] gap-2 px-1.5 sm:px-2">
                    <Avatar className="size-7 shrink-0">
                      <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                        {initials || "OP"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden truncate text-sm sm:inline">
                      {session.fullName ?? session.email}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="space-y-1">
                    <p className="text-sm font-medium">{session.fullName ?? "Staff member"}</p>
                    <p className="truncate text-xs font-normal text-muted-foreground">
                      {session.email}
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {(session.roles ?? []).map((role) => (
                        <Badge key={role} variant="secondary" className="text-[10px] capitalize">
                          {roleLabel(role)}
                        </Badge>
                      ))}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void signOut()}>
                    <LogOut className="mr-2 size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
        )}

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">
          {loading ? (
            <div className="mx-auto w-full max-w-[1600px] space-y-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading console…
              </div>
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-24 w-full" />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-80 w-full" />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1600px]">
              <nav aria-label="Breadcrumb" className="mb-3 lg:hidden">
                <Breadcrumb>
                  <BreadcrumbList>
                    {breadcrumb.map((crumb, index) => (
                      <Fragment key={crumb}>
                        <BreadcrumbItem>
                          <BreadcrumbPage
                            className={
                              index === breadcrumb.length - 1
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {crumb}
                          </BreadcrumbPage>
                        </BreadcrumbItem>
                        {index < breadcrumb.length - 1 && <BreadcrumbSeparator />}
                      </Fragment>
                    ))}
                  </BreadcrumbList>
                </Breadcrumb>
              </nav>

              <div className="mb-6 flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1 basis-[22rem]">
                  <h1 className="font-display text-2xl font-semibold tracking-tight md:text-[1.75rem]">
                    {title}
                  </h1>
                  {description && (
                    <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  )}
                </div>
                {actions && (
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
                )}
              </div>

              {children}
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
