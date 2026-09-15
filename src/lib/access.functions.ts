import { audit } from "@/lib/audit";
import {
  delay,
  invitations as demoInvitations,
  permissions,
  profiles,
  restaurantStaff,
  restaurants,
  rolePermissions,
  uid,
  userRoles,
} from "@/lib/demo-store";
import type { StaffRole } from "@/lib/session.functions";

export interface StaffMember {
  user_id: string;
  email: string;
  full_name: string | null;
  job_title: string | null;
  last_login_at: string | null;
  roles: StaffRole[];
  restaurants: { restaurant_id: string; name: string; role: string }[];
}

export interface Invitation {
  id: string;
  email: string;
  role: StaffRole;
  restaurant_id: string | null;
  restaurant_name: string | null;
  status: string;
  message: string | null;
  expires_at: string;
  created_at: string;
}

export interface AccessPayload {
  staff: StaffMember[];
  invitations: Invitation[];
  permissions: { code: string; module: string; description: string }[];
  rolePermissions: { role: StaffRole; permission_code: string }[];
  restaurants: { id: string; name: string }[];
}

export async function getAccessOverview(): Promise<AccessPayload> {
  await delay(90);
  const restaurantNames = Object.fromEntries(restaurants.map((r) => [r.id, r.name]));
  const staff: StaffMember[] = profiles.map((p) => ({
    user_id: p.user_id,
    email: p.email,
    full_name: p.full_name,
    job_title: p.job_title,
    last_login_at: p.last_login_at,
    roles: userRoles.filter((r) => r.user_id === p.user_id).map((r) => r.role as StaffRole),
    restaurants: restaurantStaff
      .filter((rs) => rs.user_id === p.user_id && rs.is_active)
      .map((rs) => ({
        restaurant_id: rs.restaurant_id,
        name: restaurantNames[rs.restaurant_id] ?? "—",
        role: rs.role,
      })),
  }));
  const invitations: Invitation[] = demoInvitations.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role as StaffRole,
    restaurant_id: i.restaurant_id,
    restaurant_name: i.restaurant_id ? restaurantNames[i.restaurant_id] ?? null : null,
    status: i.status,
    message: i.message,
    expires_at: i.expires_at,
    created_at: i.created_at,
  }));
  return {
    staff,
    invitations,
    permissions,
    rolePermissions: rolePermissions.map((rp) => ({ role: rp.role as StaffRole, permission_code: rp.permission_code })),
    restaurants: restaurants.map((r) => ({ id: r.id, name: r.name })),
  };
}

export async function inviteStaff(input: {
  email: string;
  role: StaffRole;
  restaurantId?: string | null;
  message?: string;
}) {
  await delay(80);
  demoInvitations.push({
    id: uid("inv"),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    restaurant_id: input.restaurantId ?? null,
    status: "pending",
    message: input.message ?? null,
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  });
  audit({
    action: "staff.invited",
    entityType: "staff_invitation",
    after: { email: input.email, role: input.role },
  });
  return { ok: true };
}

export async function revokeInvitation(input: { id: string }) {
  await delay(50);
  const inv = demoInvitations.find((i) => i.id === input.id);
  if (inv) inv.status = "revoked";
  return { ok: true };
}

export async function setRestaurantStaff(input: {
  restaurantId: string;
  userId: string;
  role: StaffRole;
  remove?: boolean;
}) {
  await delay(50);
  if (input.remove) {
    for (let i = restaurantStaff.length - 1; i >= 0; i--) {
      const rs = restaurantStaff[i]!;
      if (rs.restaurant_id === input.restaurantId && rs.user_id === input.userId && rs.role === input.role) {
        restaurantStaff.splice(i, 1);
      }
    }
    return { ok: true };
  }
  const existing = restaurantStaff.find(
    (rs) => rs.restaurant_id === input.restaurantId && rs.user_id === input.userId && rs.role === input.role,
  );
  if (!existing) {
    restaurantStaff.push({
      id: uid("rs"),
      restaurant_id: input.restaurantId,
      user_id: input.userId,
      role: input.role,
      is_active: true,
    });
  }
  return { ok: true };
}

export async function setPlatformRole(input: { userId: string; role: StaffRole; grant: boolean }) {
  await delay(60);
  if (input.grant) {
    if (!userRoles.some((ur) => ur.user_id === input.userId && ur.role === input.role)) {
      userRoles.push({ user_id: input.userId, role: input.role });
    }
  } else {
    for (let i = userRoles.length - 1; i >= 0; i--) {
      if (userRoles[i]!.user_id === input.userId && userRoles[i]!.role === input.role) {
        userRoles.splice(i, 1);
      }
    }
  }
  audit({
    action: input.grant ? "role.granted" : "role.revoked",
    entityType: "user_role",
    entityId: input.userId,
    after: { role: input.role },
  });
  return { ok: true };
}

export async function claimInvitations() {
  // Demo-only: invitations sit in the list; auto-claim on sign-in isn't necessary.
  return { claimed: 0 };
}
