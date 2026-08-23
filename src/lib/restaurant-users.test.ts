import { describe, expect, it } from "vitest";

import {
  getDefaultPermissionsForRole,
  mapToPermissions,
  permissionsToMap,
  RESTAURANT_PERMISSION_CODES,
  RESTAURANT_ROLES,
} from "@/lib/restaurant-permissions";
import { normalizeRestaurantUser } from "@/lib/restaurant-users.firebase";

describe("restaurant-permissions", () => {
  it("defines defaults for every restaurant role", () => {
    for (const role of RESTAURANT_ROLES) {
      const defaults = getDefaultPermissionsForRole(role);
      expect(defaults.length).toBeGreaterThan(0);
      for (const code of defaults) {
        expect(RESTAURANT_PERMISSION_CODES).toContain(code);
      }
    }
  });

  it("restaurant owner receives all restaurant management permissions", () => {
    expect(getDefaultPermissionsForRole("restaurant_owner")).toEqual(RESTAURANT_PERMISSION_CODES);
  });

  it("round-trips permission maps", () => {
    const codes = getDefaultPermissionsForRole("restaurant_manager");
    expect(mapToPermissions(permissionsToMap(codes))).toEqual(codes);
  });
});

describe("normalizeRestaurantUser", () => {
  it("requires email, restaurant_id and valid role", () => {
    expect(
      normalizeRestaurantUser(
        {
          email: "manager@test.co",
          restaurant_id: "rst-1",
          role: "restaurant_manager",
          permissions: permissionsToMap(["rm.orders.view"]),
          status: "active",
        },
        "uid-1",
      ),
    ).toMatchObject({
      uid: "uid-1",
      email: "manager@test.co",
      restaurant_id: "rst-1",
      role: "restaurant_manager",
      permissions: ["rm.orders.view"],
      status: "active",
    });

    expect(
      normalizeRestaurantUser(
        { email: "manager@test.co", restaurant_id: "", role: "restaurant_manager" },
        "uid-2",
      ),
    ).toBeNull();

    expect(
      normalizeRestaurantUser(
        { email: "manager@test.co", restaurant_id: "rst-1", role: "super_admin" },
        "uid-3",
      ),
    ).toBeNull();
  });

  it("excludes soft-deleted users", () => {
    expect(
      normalizeRestaurantUser(
        {
          email: "manager@test.co",
          restaurant_id: "rst-1",
          role: "restaurant_manager",
          is_deleted: true,
        },
        "uid-4",
      ),
    ).toBeNull();
  });
});
