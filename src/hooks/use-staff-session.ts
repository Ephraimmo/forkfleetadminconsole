import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import {
  getStaffSession,
  getStoredSessionSync,
  isSignedInLocally,
  type StaffRole,
  type StaffSession,
} from "@/lib/session.functions";

export function useStaffSession() {
  const fetchSession = useServerFn(getStaffSession);

  // Synchronously preload a cached session when one is already stored in
  // localStorage so the sidebar/topbar never render an empty permissions set
  // before the async query resolves.
  const initial: StaffSession | null =
    typeof window !== "undefined" && isSignedInLocally() ? getStoredSessionSync() : null;

  const query = useQuery<StaffSession | null>({
    queryKey: ["staff-session"],
    queryFn: () => fetchSession() as Promise<StaffSession | null>,
    staleTime: 60_000,
    initialData: initial,
  });

  const session = query.data ?? null;
  const roles = session?.roles ?? [];
  const permissions = session?.permissions ?? [];

  return {
    ...query,
    session: session ?? undefined,
    isSignedIn: !!session,
    roles,
    permissions,
    hasRole: (role: StaffRole) => roles.includes(role),
    hasAnyRole: (candidates: StaffRole[]) => candidates.some((r) => roles.includes(r)),
    hasPermission: (code: string) => permissions.includes(code),
    hasAnyPermission: (codes: string[]) => codes.some((c) => permissions.includes(c)),
  };
}
