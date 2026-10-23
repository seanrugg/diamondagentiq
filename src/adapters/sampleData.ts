/**
 * SAMPLE_MODE data source: the same tables Zetaris serves (data/schema.sql,
 * data/seed.sql, data/rules.sql), loaded into an in-process Postgres (PGlite,
 * WebAssembly, no network) so a judge without Zetaris can run the real SQL.
 * Rows come back as strings, the way Zetaris REST returns them.
 */
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";

let db: Promise<PGlite> | null = null;

const read = (name: string) => readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8");

async function open(): Promise<PGlite> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.exec("CREATE SCHEMA diq_pg; SET search_path TO diq_pg, public;");
  for (const file of ["schema.sql", "seed.sql", "rules.sql", "migrations/005_summer_league_house_rules.sql"]) {
    await pg.exec(read(file));
  }
  return pg;
}

function asZetarisValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function sampleSql(sql: string): Promise<{ data: (string | null)[][]; columns: string[] }> {
  db ??= open();
  const pg = await db;
  const result = await pg.query<unknown[]>(sql, [], { rowMode: "array" });
  return {
    data: result.rows.map((row) => row.map(asZetarisValue)),
    columns: result.fields.map((f) => f.name),
  };
}
