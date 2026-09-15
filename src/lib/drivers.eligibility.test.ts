import { describe, expect, it } from "vitest";
import {
  assignmentKey,
  hasActiveAssignment,
  isApprovedDriver,
  normalizeBranchKey,
  normalizeRestaurantKey,
  type DriverAssignment,
} from "./drivers.firebase";

/** Build a minimal assignment record for the assertions below. */
function assignment(
  driverId: string,
  restaurantId: string,
  branchId: string,
  is_active = true,
): DriverAssignment {
  return {
    id: assignmentKey(driverId, restaurantId, branchId),
    driver_id: driverId,
    restaurant_id: restaurantId,
    branch_id: branchId,
    is_active,
  };
}

describe("normalizeBranchKey", () => {
  it("treats 'main' and 'brn-main' as the same branch", () => {
    expect(normalizeBranchKey("main")).toBe(normalizeBranchKey("brn-main"));
  });
  it("treats 'Branch Test1' and 'branch-test1' as the same branch", () => {
    expect(normalizeBranchKey("Branch Test1")).toBe(normalizeBranchKey("branch-test1"));
  });
  it("handles empty/undefined", () => {
    expect(normalizeBranchKey(undefined)).toBe("");
    expect(normalizeBranchKey(null)).toBe("");
  });
});

describe("normalizeRestaurantKey", () => {
  it("treats 'rst-burgerlab' and 'burgerlab' as the same restaurant", () => {
    expect(normalizeRestaurantKey("rst-burgerlab")).toBe(normalizeRestaurantKey("burgerlab"));
  });
});

describe("isApprovedDriver", () => {
  it("approves a verified offline driver (freshly approved)", () => {
    expect(isApprovedDriver({ is_verified: true, status: "offline" })).toBe(true);
  });
  it("approves a verified online/busy driver", () => {
    expect(isApprovedDriver({ is_verified: true, status: "online" })).toBe(true);
    expect(isApprovedDriver({ is_verified: true, status: "busy" })).toBe(true);
  });
  it("rejects pending/suspended/rejected even if verified", () => {
    expect(isApprovedDriver({ is_verified: true, status: "pending" })).toBe(false);
    expect(isApprovedDriver({ is_verified: true, status: "suspended" })).toBe(false);
    expect(isApprovedDriver({ is_verified: true, status: "rejected" })).toBe(false);
  });
  it("rejects an unverified driver", () => {
    expect(isApprovedDriver({ is_verified: false, status: "online" })).toBe(false);
    expect(isApprovedDriver({ status: "online" })).toBe(false);
  });
});

describe("hasActiveAssignment — the assignment decision", () => {
  const driver = "drv-1";

  it("matches an exact restaurant + branch assignment", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-main")];
    expect(hasActiveAssignment(rows, driver, "rst-burgerlab", "brn-main")).toBe(true);
  });

  it("matches when branch ids differ only by prefix ('main' vs 'brn-main')", () => {
    const rows = [assignment(driver, "rst-burgerlab", "main")];
    expect(hasActiveAssignment(rows, driver, "rst-burgerlab", "brn-main")).toBe(true);
  });

  it("matches when restaurant ids differ only by prefix ('burgerlab' vs 'rst-burgerlab')", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-main")];
    expect(hasActiveAssignment(rows, driver, "burgerlab", "brn-main")).toBe(true);
  });

  it("matches any branch of the restaurant when the order has no branch (legacy)", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-test1")];
    expect(hasActiveAssignment(rows, driver, "rst-burgerlab", null)).toBe(true);
    expect(hasActiveAssignment(rows, driver, "rst-burgerlab", "")).toBe(true);
  });

  it("rejects a driver assigned to a different restaurant", () => {
    const rows = [assignment(driver, "rst-nonna", "brn-main")];
    expect(hasActiveAssignment(rows, driver, "rst-burgerlab", "brn-main")).toBe(false);
  });

  it("rejects a driver assigned to a different branch of the right restaurant", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-main")];
    expect(hasActiveAssignment(rows, driver, "rst-burgerlab", "brn-test1")).toBe(false);
  });

  it("rejects an inactive assignment", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-main", false)];
    expect(hasActiveAssignment(rows, driver, "rst-burgerlab", "brn-main")).toBe(false);
  });

  it("rejects when the order has no restaurant", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-main")];
    expect(hasActiveAssignment(rows, driver, null, "brn-main")).toBe(false);
  });

  it("full eligibility: approved driver assigned to the order's branch IS eligible", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-main")];
    const approved = isApprovedDriver({ is_verified: true, status: "offline" });
    expect(approved && hasActiveAssignment(rows, driver, "rst-burgerlab", "brn-main")).toBe(true);
  });

  it("full eligibility: approved driver assigned to a different branch is NOT eligible", () => {
    const rows = [assignment(driver, "rst-burgerlab", "brn-main")];
    const approved = isApprovedDriver({ is_verified: true, status: "online" });
    expect(approved && hasActiveAssignment(rows, driver, "rst-burgerlab", "brn-test1")).toBe(false);
  });
});

describe("assignmentKey", () => {
  it("formats the unique tuple key", () => {
    expect(assignmentKey("drv-1", "rst-burgerlab", "brn-main")).toBe(
      "drv-1__rst-burgerlab__brn-main",
    );
  });
});
