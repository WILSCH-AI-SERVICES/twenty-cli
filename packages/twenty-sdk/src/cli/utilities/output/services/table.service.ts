export class TableService {
  render(data: unknown): void {
    const records = normalizeRecords(data);
    if (records.length === 0) {
      // eslint-disable-next-line no-console
      console.log("No records found.");
      return;
    }

    if (records.length === 1 && !isRecord(records[0])) {
      // eslint-disable-next-line no-console
      console.log(String(records[0]));
      return;
    }

    const rows = records.map((record) => (isRecord(record) ? record : { value: record }));
    const firstRow = rows[0];
    if (firstRow === undefined) {
      return;
    }

    const columns = extractColumns(firstRow);
    const widths = calculateWidths(columns, rows);

    // eslint-disable-next-line no-console
    console.log(columns.map((col, i) => col.toUpperCase().padEnd(widths[i] ?? 0)).join("  "));

    for (const record of rows) {
      const row = columns.map((col, i) => {
        const value = getValue(record, col);
        const width = widths[i] ?? 0;
        const cell = formatValue(value).slice(0, width);
        return cell.padEnd(width);
      });
      // eslint-disable-next-line no-console
      console.log(row.join("  "));
    }
  }
}

function normalizeRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data == null) return [];
  return [data];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractColumns(record: Record<string, unknown>): string[] {
  const priority = ["id", "name", "email", "title", "status", "createdAt"];
  const keys = Object.keys(record);
  return [
    ...priority.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !priority.includes(k)).sort(),
  ];
}

function calculateWidths(columns: string[], records: Record<string, unknown>[]): number[] {
  return columns.map((column) => {
    const maxCell = records.reduce((max, record) => {
      const value = formatValue(getValue(record, column));
      return Math.max(max, value.length);
    }, column.length);
    return Math.min(Math.max(maxCell, column.length), 60);
  });
}

function getValue(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((obj, key) => {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return (obj as Record<string, unknown>)[key];
    }
    return undefined;
  }, record);
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
