import { type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useStaffSession } from "@/hooks/use-staff-session";

/**
 * Wraps a management screen with the shell, a loading state, an auth redirect
 * and a permission check. Renders an access-denied panel when the signed-in
 * staff member lacks any of the required permission codes.
 *
 * AppShell itself fetches the session, shows loading skeletons and handles
 * sign-out — we only need the session here to decide access control.
 */
export function PermissionGate({
  required,
  breadcrumb,
  title,
  description,
  actions,
  children,
}: {
  required: string[];
  breadcrumb: string[];
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode | ((staff: ReturnType<typeof useStaffSession>) => ReactNode);
}) {
  const staff = useStaffSession();
  const session = staff.session;
  const allowed =
    !session || required.length === 0 || staff.hasAnyPermission(required);

  return (
    <AppShell
      breadcrumb={breadcrumb}
      title={title}
      {...(description ? { description } : {})}
      {...(allowed && session && actions ? { actions } : {})}
    >
      {session && allowed ? (
        typeof children === "function" ? children(staff) : children
      ) : session ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldAlert className="size-8 text-destructive" />
            <div>
              <p className="font-medium">You don't have access to this area</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Required permission: {required.join(" or ")}. Ask a platform administrator to grant it.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </AppShell>
  );
}
