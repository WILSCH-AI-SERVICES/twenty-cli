import { UnsupportedDbReadError } from "../../readbackend/types";
import { parsePrimitive } from "../../shared/parse";

export interface DbFilterClause {
  field: string;
  operator: string;
  value: unknown;
}

const FILTER_CLAUSE_PATTERN = /^([^[\]:]+)(?:\[([^[\]]+)\])?:(.*)$/;

export class DbFilterCompilerService {
  compile(filter?: string): DbFilterClause[] {
    if (!filter) {
      return [];
    }

    return filter
      .split(";")
      .map((clause) => clause.trim())
      .filter(Boolean)
      .map((clause) => parseClause(clause));
  }
}

function parseClause(clause: string): DbFilterClause {
  const match = FILTER_CLAUSE_PATTERN.exec(clause);

  if (!match) {
    throw new UnsupportedDbReadError(
      `DB reads do not support filter clause ${JSON.stringify(clause)}.`,
    );
  }

  const [, field, operator = "eq", rawValue] = match;
  if (field === undefined || rawValue === undefined) {
    throw new UnsupportedDbReadError(
      `DB reads do not support filter clause ${JSON.stringify(clause)}.`,
    );
  }

  if (field.includes(".")) {
    throw new UnsupportedDbReadError(
      `DB reads do not support nested filter field ${JSON.stringify(field)}.`,
    );
  }

  return {
    field,
    operator,
    value: parseFilterValue(rawValue),
  };
}

function parseFilterValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();

    if (!inner) {
      return [];
    }

    return inner.split(",").map((item) => parsePrimitive(item.trim()));
  }

  return parsePrimitive(trimmed);
}
