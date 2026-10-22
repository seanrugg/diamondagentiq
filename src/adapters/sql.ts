export function normalizeSql(sql: string): string {
  const trimmed = sql.trim();
  const withoutTrailingSemi = trimmed.endsWith(";")
    ? trimmed.slice(0, -1).trim()
    : trimmed;

  if (!withoutTrailingSemi) {
    throw new Error("SQL statement is empty");
  }

  if (withoutTrailingSemi.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed");
  }

  return withoutTrailingSemi;
}
