import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Store,
  UtensilsCrossed,
  Boxes,
  ReceiptText,
  Users,
  Bike,
  Radar,
  Map as MapIcon,
  CreditCard,
  BadgePercent,
  Bell,
  LifeBuoy,
  Settings,
  ScrollText,
  ShieldCheck,
  FileBarChart,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = { title: string; url: string; icon: typeof Store; permission?: string; soon?: boolean };

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
      { title: "Live map", url: "/live-map", icon: MapIcon, permission: "dispatch.manage" },
      { title: "Orders", url: "/orders", icon: ReceiptText, permission: "orders.view" },
      { title: "Kitchen queue", url: "/kitchen", icon: UtensilsCrossed, permission: "orders.view" },
      { title: "Dispatch", url: "/dispatch", icon: Radar, permission: "dispatch.manage" },
      { title: "Drivers", url: "/drivers", icon: Bike, permission: "drivers.view" },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { title: "Restaurants", url: "/restaurants", icon: Store, permission: "restaurants.view" },
      { title: "Menus", url: "/menus", icon: UtensilsCrossed, permission: "menus.view" },
      { title: "Inventory", url: "/inventory", icon: Boxes, permission: "inventory.view" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { title: "Customers", url: "/customers", icon: Users, permission: "customers.view" },
      { title: "Payments", url: "/payments", icon: CreditCard, permission: "finance.view" },
      { title: "Promotions", url: "/promotions", icon: BadgePercent, permission: "promotions.view" },
      { title: "Reports", url: "/reports", icon: FileBarChart, permission: "reports.view" },
    ],
  },
  {
    label: "Platform",
    items: [
      { title: "Access control", url: "/access", icon: ShieldCheck, permission: "users.view" },
      { title: "Notifications", url: "/notifications", icon: Bell, permission: "notifications.manage" },
      { title: "Support", url: "/support", icon: LifeBuoy, permission: "support.view" },
      { title: "Audit logs", url: "/audit-logs", icon: ScrollText, permission: "audit.view" },
      { title: "Settings", url: "/settings", icon: Settings, permission: "settings.manage" },
    ],
  },
];

export function AppSidebar({ permissions }: { permissions: string[] }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const allow = (item: NavItem) => !item.permission || permissions.includes(item.permission);
  // Keep the parent item highlighted on nested routes (e.g. /restaurants/42)
  const isActive = (url: string) => pathname === url || pathname.startsWith(`${url}/`);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-panel">
            <UtensilsCrossed className="size-4" />
          </span>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="truncate font-display text-sm font-semibold tracking-tight">ForkFleet</p>
              <p className="truncate text-[11px] text-muted-foreground">Operations Console</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0.5">
        {groups.map((group) => {
          const items = group.items.filter(allow);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = isActive(item.url);
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild={!item.soon}
                          isActive={active}
                          tooltip={item.title}
                          className="relative data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                        >
                          <Link to={item.url} className="flex items-center gap-2.5">
                            <span
                              aria-hidden
                              className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity ${
                                active ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            <item.icon
                              className={`size-4 shrink-0 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
                            />
                            {!collapsed && <span className="truncate">{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
