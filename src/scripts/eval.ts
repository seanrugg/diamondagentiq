#!/usr/bin/env tsx
/**
 * npm run eval [-- --only <id>]
 * Runs every question in data/evals/questions.json through the live agent team
 * and scores each answer against its checklist. Writes a report to logs/.
 * Slow (several model calls per question) and uses Nightshift credits.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { scoreAnswer, EvalFileSchema } from "../evals/score.js";
import { runSituation } from "../orchestrator.js";
import { SituationRequestSchema } from "../schemas/situation.js";

const localToday = () =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function main(): Promise<void> {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  const file = EvalFileSchema.parse(JSON.parse(readFileSync("data/evals/questions.json", "utf8")));
  const questions = file.questions.filter((q) => !only || q.id === only);

  const report: unknown[] = [];
  let passed = 0;
  let total = 0;
  for (const [n, q] of questions.entries()) {
    console.error(`\n→ [${n + 1}/${questions.length}] ${q.id} ...`);
    const request = SituationRequestSchema.parse(q.request);
    const started = Date.now();
    const result = await runSituation(request, q.today ?? localToday()).catch((error: unknown) => ({
      ok: false as const,
      error: { stage: "eval", message: error instanceof Error ? error.message : String(error), trace_id: "" },
    }));
    const seconds = Math.round((Date.now() - started) / 1000);
    if (!result.ok) {
      console.log(`\n✗ ${q.id} (${seconds}s): failed at ${result.error.stage}: ${result.error.message}`);
      report.push({ id: q.id, error: result.error });
      total += 1;
      continue;
    }
    const checks = scoreAnswer(result.answer, q.checks);
    const ok = checks.filter((c) => c.pass).length;
    passed += ok;
    total += checks.length;
    console.log(`\n${ok === checks.length ? "✓" : "•"} ${q.id}: ${ok}/${checks.length} checks (${seconds}s, confidence ${result.answer.confidence})`);
    for (const c of checks.filter((x) => !x.pass)) console.log(`   ✗ ${c.check}${c.detail ? ` (${c.detail})` : ""}`);
    report.push({ id: q.id, checks, answer: result.answer });
  }

  console.log(`\nTotal: ${passed}/${total} checks passed`);
  mkdirSync("logs", { recursive: true });
  const path = `logs/eval-${new Date().toISOString().replaceAll(":", "-")}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`Report: ${path}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
