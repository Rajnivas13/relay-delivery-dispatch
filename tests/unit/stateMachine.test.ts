import { describe, expect, it } from "vitest";
import { AppError } from "@/domain/errors";
import { assertTransition, canTransition, isAssignable, isTerminal, TRANSITIONS } from "@/domain/jobStateMachine";
import { JOB_STATUSES } from "@/domain/types";

describe("job state machine", () => {
  it("allows the happy path", () => {
    const path = ["NEW", "READY_FOR_ASSIGNMENT", "AWAITING_CONFIRMATION", "ACCEPTED", "PICKED_UP", "DELIVERED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it("rejects delivering before pickup", () => {
    expect(canTransition("ACCEPTED", "DELIVERED")).toBe(false);
    expect(() => assertTransition("ACCEPTED", "DELIVERED")).toThrowError(AppError);
  });

  it("keeps cancelled and delivered jobs terminal", () => {
    for (const to of JOB_STATUSES) {
      expect(canTransition("CANCELLED", to)).toBe(false);
      expect(canTransition("DELIVERED", to)).toBe(false);
    }
    expect(isTerminal("CANCELLED")).toBe(true);
  });

  it("does not allow cancelling once picked up", () => {
    expect(canTransition("PICKED_UP", "CANCELLED")).toBe(false);
  });

  it("routes timeouts and rejections to the manual queue, which can be reassigned", () => {
    expect(canTransition("AWAITING_CONFIRMATION", "MANUAL_QUEUE")).toBe(true);
    expect(canTransition("MANUAL_QUEUE", "AWAITING_CONFIRMATION")).toBe(true);
    expect(isAssignable("MANUAL_QUEUE")).toBe(true);
    expect(isAssignable("ACCEPTED")).toBe(false);
  });

  it("reports the allowed targets on an invalid transition", () => {
    try {
      assertTransition("PICKED_UP", "CANCELLED");
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe("INVALID_TRANSITION");
      expect((err as AppError).details).toMatchObject({ allowed: TRANSITIONS.PICKED_UP });
    }
  });
});
