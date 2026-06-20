export interface DbTableReference {
  schemaName?: string;
  tableName: string;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function quoteTableReference(reference: DbTableReference): string {
  const tableName = quoteIdentifier(reference.tableName);

  if (!reference.schemaName) {
    return tableName;
  }

  return `${quoteIdentifier(reference.schemaName)}.${tableName}`;
}
