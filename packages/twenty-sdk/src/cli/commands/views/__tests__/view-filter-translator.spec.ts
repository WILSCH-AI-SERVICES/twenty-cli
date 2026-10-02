import { describe, it, expect } from "vitest";

import { CliError } from "../../../utilities/errors/cli-error";
import { startOfDayIn, translateFilter, translateView } from "../view-filter-translator";

// 2026-10-02 17:30 UTC is 19:30 in Berlin (CEST, UTC+2).
const ctx = { now: new Date("2026-10-02T17:30:00.000Z"), timeZone: "Europe/Berlin" };

describe("startOfDayIn", () => {
  it("finds Berlin's midnight as a UTC instant, across DST", () => {
    expect(startOfDayIn(ctx.now, "Europe/Berlin").toISOString()).toBe("2026-10-01T22:00:00.000Z");
    expect(startOfDayIn(ctx.now, "Europe/Berlin", 1).toISOString()).toBe(
      "2026-10-02T22:00:00.000Z",
    );
    // 2026-10-25 is the switch back to CET (UTC+1).
    expect(startOfDayIn(new Date("2026-10-26T10:00:00Z"), "Europe/Berlin").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });
});

describe("translateFilter", () => {
  it("SELECT IS / IS_NOT, the latter keeping empty values", () => {
    expect(
      translateFilter(
        { fieldName: "stage", fieldType: "SELECT", operand: "IS", value: '["OPEN","NURTURE"]' },
        ctx,
      ),
    ).toBe("stage[in]:[OPEN,NURTURE]");
    expect(
      translateFilter(
        { fieldName: "status", fieldType: "SELECT", operand: "IS_NOT", value: '["DONE"]' },
        ctx,
      ),
    ).toBe("or(status[is]:NULL,not(status[in]:[DONE]))");
  });

  it("empty and not empty", () => {
    expect(
      translateFilter(
        { fieldName: "nextActivityDate", fieldType: "DATE", operand: "IS_EMPTY", value: "" },
        ctx,
      ),
    ).toBe("nextActivityDate[is]:NULL");
    expect(
      translateFilter(
        { fieldName: "dueAt", fieldType: "DATE_TIME", operand: "IS_NOT_EMPTY", value: "" },
        ctx,
      ),
    ).toBe("dueAt[is]:NOT_NULL");
  });

  it("DATE_TIME past and today against the operator's calendar", () => {
    expect(
      translateFilter(
        { fieldName: "dueAt", fieldType: "DATE_TIME", operand: "IS_IN_PAST", value: "" },
        ctx,
      ),
    ).toBe("dueAt[lt]:2026-10-02T17:30:00.000Z");
    expect(
      translateFilter(
        { fieldName: "dueAt", fieldType: "DATE_TIME", operand: "IS_TODAY", value: "" },
        ctx,
      ),
    ).toBe("and(dueAt[gte]:2026-10-01T22:00:00.000Z,dueAt[lt]:2026-10-02T22:00:00.000Z)");
    expect(
      translateFilter({ fieldName: "d", fieldType: "DATE", operand: "IS_TODAY", value: "" }, ctx),
    ).toBe("d[eq]:2026-10-02");
  });

  it("refuses an operand it cannot express rather than widening the result", () => {
    expect(() =>
      translateFilter(
        { fieldName: "name", fieldType: "TEXT", operand: "CONTAINS", value: "x" },
        ctx,
      ),
    ).toThrow(CliError);
  });
});

describe("translateView", () => {
  it("nests groups: status not done AND (overdue OR today)", () => {
    const groups = [
      { id: "root", logicalOperator: "AND", positionInViewFilterGroup: 0 },
      {
        id: "due",
        parentViewFilterGroupId: "root",
        logicalOperator: "OR",
        positionInViewFilterGroup: 1,
      },
    ];
    const filters = [
      {
        fieldName: "status",
        fieldType: "SELECT",
        operand: "IS_NOT",
        value: '["DONE"]',
        viewFilterGroupId: "root",
        positionInViewFilterGroup: 0,
      },
      {
        fieldName: "dueAt",
        fieldType: "DATE_TIME",
        operand: "IS_IN_PAST",
        value: "",
        viewFilterGroupId: "due",
        positionInViewFilterGroup: 1,
      },
      {
        fieldName: "dueAt",
        fieldType: "DATE_TIME",
        operand: "IS_TODAY",
        value: "",
        viewFilterGroupId: "due",
        positionInViewFilterGroup: 2,
      },
    ];
    expect(translateView(filters, groups, ctx)).toBe(
      "and(or(status[is]:NULL,not(status[in]:[DONE])),or(dueAt[lt]:2026-10-02T17:30:00.000Z,and(dueAt[gte]:2026-10-01T22:00:00.000Z,dueAt[lt]:2026-10-02T22:00:00.000Z)))",
    );
  });

  it("is empty for a view with no filters", () => {
    expect(translateView([], [], ctx)).toBe("");
  });
});
