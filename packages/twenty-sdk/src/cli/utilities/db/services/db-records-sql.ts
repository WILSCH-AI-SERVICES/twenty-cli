import { UnsupportedDbReadError } from "../../readbackend/types";
import type { DbFilterClause } from "./db-filter-compiler.service";
import {
  buildKeysetWhereClause,
  encodeRecordCursor,
  type RecordListCursor,
} from "./db-records-cursor";
import { quoteIdentifier } from "./db-sql-identifiers";

const SIMPLE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function buildListWhereClause(
  clauses: DbFilterClause[],
  cursor: RecordListCursor | null,
): { whereSql: string; params: unknown[] } {
  const fragments: string[] = [];
  const params: unknown[] = [];

  for (const clause of clauses) {
    fragments.push(compileFilterClause(clause, params));
  }

  if (cursor !== null) {
    const keyset = buildKeysetWhereClause(cursor, params.length + 1);
    fragments.push(keyset.sql);
    params.push(...keyset.params);
  }

  if (fragments.length === 0) {
    return { whereSql: "", params };
  }

  return { whereSql: `where ${fragments.join(" and ")}`, params };
}

export function buildOrderByForKeyset(sortField: string, direction: "asc" | "desc"): string {
  const sortColumn = quoteColumn(sortField);
  const nullsOrdering = direction === "desc" ? "nulls last" : "nulls first";

  if (sortField === "id") {
    return `order by ${sortColumn} ${direction} ${nullsOrdering}`;
  }

  return `order by ${sortColumn} ${direction} ${nullsOrdering}, ${quoteColumn("id")} asc`;
}

export function buildEndCursor(
  lastRow: unknown,
  sortField: string,
  sortDirection: "asc" | "desc",
): string | undefined {
  const record = asRecord(lastRow);

  if (!record) {
    return undefined;
  }

  const idValue = record.id;

  if (typeof idValue !== "string" || idValue.length === 0) {
    return undefined;
  }

  const sortValue = sortField in record ? record[sortField] : null;

  return encodeRecordCursor({
    lastSortValue: normalizeSortValue(sortValue),
    lastId: idValue,
    sortField,
    sortDirection,
  });
}

export function normalizeSortValue(value: unknown): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return JSON.stringify(value);
}

export function compileFilterClause(clause: DbFilterClause, params: unknown[]): string {
  const field = quoteColumn(clause.field);

  switch (clause.operator) {
    case "eq":
      if (clause.value === null) {
        return `${field} is null`;
      }
      params.push(clause.value);
      return `${field} = $${params.length}`;
    case "neq":
      if (clause.value === null) {
        return `${field} is not null`;
      }
      params.push(clause.value);
      return `${field} <> $${params.length}`;
    case "gt":
      params.push(clause.value);
      return `${field} > $${params.length}`;
    case "gte":
      params.push(clause.value);
      return `${field} >= $${params.length}`;
    case "lt":
      params.push(clause.value);
      return `${field} < $${params.length}`;
    case "lte":
      params.push(clause.value);
      return `${field} <= $${params.length}`;
    case "in":
      if (!Array.isArray(clause.value)) {
        throw new UnsupportedDbReadError(
          `DB list requires array values for [in] filters on ${JSON.stringify(clause.field)}.`,
        );
      }
      params.push(clause.value);
      return `${field} = any($${params.length})`;
    case "is":
      if (clause.value === null || clause.value === "null") {
        return `${field} is null`;
      }
      if (clause.value === "not_null") {
        return `${field} is not null`;
      }
      throw new UnsupportedDbReadError(
        `DB list does not support [is] value ${JSON.stringify(clause.value)}.`,
      );
    default:
      throw new UnsupportedDbReadError(
        `DB list does not support filter operator ${JSON.stringify(clause.operator)}.`,
      );
  }
}

export function quoteColumn(column: string): string {
  if (!SIMPLE_IDENTIFIER_PATTERN.test(column)) {
    throw new UnsupportedDbReadError(`DB list does not support field ${JSON.stringify(column)}.`);
  }

  return `t.${quoteIdentifier(column)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
