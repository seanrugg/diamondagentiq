/**
 * npm run rules:build
 * Regenerates data/rules.sql from data/rules/*.csv and data/coaching/insights.csv. No network, no secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildRulesSql } from "../data/rulesSql.js";

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
