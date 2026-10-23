/**
 * npm run rules:build
 * Regenerates data/rules.sql and the docs/coaching/*.md reference pages from
 * data/rules/*.csv and data/coaching/*.csv. No network, no secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { buildCoachingDocs } from "../data/coachingDocs.js";
import { buildRulesSql } from "../data/rulesSql.js";
import { LEARNING_PHILOSOPHY } from "../agents/philosophy.js";

const read = (name: string) => readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8");

const { sql, counts } = buildRulesSql({
  ruleSources: read("rules/rule_sources.csv"),
  rulesFacts: read("rules/rules_facts.csv"),
  pitchRestRules: read("rules/pitch_rest_rules.csv"),
  coachingInsights: read("coaching/insights.csv"),
  lessons: read("coaching/lessons.csv"),
  situations: read("coaching/situations.csv"),
  stories: read("coaching/stories.csv"),
});

writeFileSync(new URL("../../data/rules.sql", import.meta.url), sql);
console.log(
  `Wrote data/rules.sql: ${counts.sources} sources, ${counts.facts} facts, ${counts.tiers} pitch-rest tiers, ${counts.insights} coaching insights, ${counts.lessons} lessons, ${counts.situations} situations, ${counts.stories} stories`,
);

const docs = buildCoachingDocs({
  philosophy: LEARNING_PHILOSOPHY,
  lessons: read("coaching/lessons.csv"),
  situations: read("coaching/situations.csv"),
  stories: read("coaching/stories.csv"),
  insights: read("coaching/insights.csv"),
  rulesFacts: read("rules/rules_facts.csv"),
});
mkdirSync(new URL("../../docs/coaching/", import.meta.url), { recursive: true });
for (const [path, content] of Object.entries(docs)) writeFileSync(new URL(`../../${path}`, import.meta.url), content);
console.log(`Wrote ${Object.keys(docs).length} pages in docs/coaching/`);
