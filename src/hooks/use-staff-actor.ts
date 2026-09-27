import { useMemo } from "react";
import { useStaffSession } from "@/hooks/use-staff-session";
import type { StaffActor } from "@/lib/dine-in";

/** The signed-in staff member, as recorded on orders and waiter requests they act on. */
export function useStaffActor(): StaffActor {
  const { session } = useStaffSession();
  const id = session?.userId ?? null;
  const email = session?.email ?? null;
  const name = session?.fullName ?? null;
  return useMemo(() => ({ id, email, name }), [id, email, name]);
}
