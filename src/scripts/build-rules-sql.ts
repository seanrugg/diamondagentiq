/**
 * npm run rules:build
 * Regenerates data/rules.sql from data/rules/*.csv. No network, no secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildRulesSql } from "../data/rulesSql.js";

const read = (name: string) => readFileSync(new URL(`../../data/rules/${name}`, import.meta.url), "utf8");

const { sql, counts } = buildRulesSql({
  ruleSources: read("rule_sources.csv"),
  rulesFacts: read("rules_facts.csv"),
  pitchRestRules: read("pitch_rest_rules.csv"),
});

writeFileSync(new URL("../../data/rules.sql", import.meta.url), sql);
console.log(
  `Wrote data/rules.sql: ${counts.sources} sources, ${counts.facts} facts, ${counts.tiers} pitch-rest tiers`,
);
