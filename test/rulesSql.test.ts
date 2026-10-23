import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "../src/data/csv.js";
import { buildRulesSql, sqlLiteral } from "../src/data/rulesSql.js";
import { buildCoachingDocs } from "../src/data/coachingDocs.js";
import { LEARNING_PHILOSOPHY } from "../src/agents/philosophy.js";

const read = (path: string) => readFileSync(new URL(`../data/${path}`, import.meta.url), "utf8");

describe("parseCsv", () => {
  it("handles quotes, embedded commas, escaped quotes and newlines", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n1,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
      ["1", ""],
    ]);
  });

  it("rejects an unterminated quote and ragged rows", () => {
    expect(() => parseCsv('a\n"open')).toThrow(/Unterminated/);
    expect(() => parseCsvRecords("a,b\n1")).toThrow(/has 1 fields/);
  });
});

describe("sqlLiteral", () => {
  it("escapes single quotes in text", () => {
    expect(sqlLiteral("Babe Ruth's league", "text", "t")).toBe("'Babe Ruth''s league'");
  });

  it("turns empty cells into NULL for every type", () => {
    for (const type of ["text", "int", "bool", "date"] as const) {
      expect(sqlLiteral("  ", type, "t")).toBe("NULL");
    }
  });

  it("validates ints, booleans and dates", () => {
    expect(sqlLiteral("12", "int", "t")).toBe("12");
    expect(sqlLiteral("false", "bool", "t")).toBe("FALSE");
    expect(sqlLiteral("2026-10-22", "date", "t")).toBe("DATE '2026-10-22'");
    expect(() => sqlLiteral("12U", "int", "t")).toThrow(/not an integer/);
    expect(() => sqlLiteral("yes", "bool", "t")).toThrow(/not a boolean/);
    expect(() => sqlLiteral("10/22/2026", "date", "t")).toThrow(/YYYY-MM-DD/);
  });
});

const tinySources =
  "source_id,sanction,sport,title,url,edition,access,use_note,retrieved_on\n" +
  "S1,little_league,both,Title,https://example.org,2026,free_official_page,,2026-10-22\n";
const tinyFacts =
  "fact_id,source_id,sport,sanction,division,age_min,age_max,edition,topic,fact_key,fact_value,unit,rule_ref,call_type,summary,source_url,verified,verified_by,retrieved_on,verify_note\n" +
  "F001,S1,both,little_league,,,,2026,protest,protestable,x,,Rule 4.19,rule,\"It's a rule, not judgment.\",https://example.org,false,,2026-10-22,\n";
const tinyTiers =
  "sanction,sport,age_min,age_max,pitches_min,pitches_max,rest_days,edition,source_url,verified,source_id\n" +
  "little_league,baseball,11,12,66,85,4,2026,https://example.org,false,S1\n";

describe("buildRulesSql", () => {
  it("builds escaped INSERTs with NULLs for empty cells", () => {
    const { sql, counts } = buildRulesSql({ ruleSources: tinySources, rulesFacts: tinyFacts, pitchRestRules: tinyTiers });
    expect(counts).toEqual({ sources: 1, facts: 1, tiers: 1, insights: 0, lessons: 0, situations: 0, stories: 0 });
    expect(sql).not.toContain("coaching_insights");
    expect(sql).toContain("'It''s a rule, not judgment.'");
    expect(sql).toMatch(/'little_league', NULL, NULL, NULL, '2026'/);
    expect(sql).toContain("INSERT INTO pitch_rest_rules");
  });

  it("rejects an unknown source_id, bad call_type and duplicate ids", () => {
    const base = { ruleSources: tinySources, rulesFacts: tinyFacts, pitchRestRules: tinyTiers };
    expect(() => buildRulesSql({ ...base, rulesFacts: tinyFacts.replace("F001,S1", "F001,S9") })).toThrow(/unknown source_id S9/);
    expect(() => buildRulesSql({ ...base, rulesFacts: tinyFacts.replace(",rule,", ",ruling,") })).toThrow(/bad call_type/);
    expect(() => buildRulesSql({ ...base, ruleSources: tinySources + tinySources.split("\n")[1] + "\n" })).toThrow(/duplicate source_id/);
  });

  it("builds coaching insights and validates source, sport, audience and topic", () => {
    const base = { ruleSources: tinySources, rulesFacts: tinyFacts, pitchRestRules: tinyTiers };
    const header = "insight_id,topic,sport,age_min,age_max,audience,situation,insight,why,try_this,source_id,verified,verified_by,verify_note\n";
    const row = "C001,plate_coverage,both,8,14,all,Strikeout away,Crowd the plate,Reach,Bat-length check,S1,false,,\n";
    const { sql, counts } = buildRulesSql({ ...base, coachingInsights: header + row });
    expect(counts.insights).toBe(1);
    expect(sql).toContain("INSERT INTO coaching_insights (insight_code, topic");
    expect(() => buildRulesSql({ ...base, coachingInsights: header + row.replace(",S1,", ",S9,") })).toThrow(/unknown source_id S9/);
    expect(() => buildRulesSql({ ...base, coachingInsights: header + row.replace(",all,", ",fans,") })).toThrow(/bad audience/);
    expect(() => buildRulesSql({ ...base, coachingInsights: header + row.replace("plate_coverage", "Plate Coverage") })).toThrow(/snake_case/);
    expect(() => buildRulesSql({ ...base, coachingInsights: header + row + row })).toThrow(/duplicate insight_id/);
  });

  it("builds lessons, situations and stories and checks every cross-reference", () => {
    const base = { ruleSources: tinySources, rulesFacts: tinyFacts, pitchRestRules: tinyTiers };
    const lessons = "lesson_id,title,principle,life_lesson,for_player,for_coach,for_parent,for_umpire,tags,source_id,verified,verified_by,verify_note\n" +
      "L001,Team,Win together,Share the load,,,,,team;last_out,S1,false,,\n";
    const situations = "situation_id,name,topic,bases,outs,count,rule_fact_codes,offense,defense,common_mistakes,lesson_ids,source_id,verified,verified_by,verify_note\n" +
      "SIT001,D3K,dropped_third_strike,third,1,two strikes,F001,Run,Throw,,L001,S1,false,,\n";
    const stories = "story_id,title,story,lesson_ids,situation_ids,source_id,verified,verified_by,verify_note\n" +
      "ST001,Title,Once upon a time,L001,SIT001,S1,false,,\n";
    const ok = buildRulesSql({ ...base, lessons, situations, stories });
    expect(ok.counts).toMatchObject({ lessons: 1, situations: 1, stories: 1 });
    expect(ok.sql).toContain("INSERT INTO coaching_lessons");
    expect(ok.sql).toContain("INSERT INTO coaching_situations");
    expect(ok.sql).toContain("INSERT INTO coaching_stories");
    expect(() => buildRulesSql({ ...base, lessons, situations: situations.replace(",F001,", ",F999,"), stories })).toThrow(/unknown fact F999/);
    expect(() => buildRulesSql({ ...base, lessons, situations: situations.replace(",L001,S1", ",L009,S1"), stories })).toThrow(/unknown lesson L009/);
    expect(() => buildRulesSql({ ...base, lessons, situations, stories: stories.replace(",SIT001,", ",SIT009,") })).toThrow(/unknown situation SIT009/);
    expect(() => buildRulesSql({ ...base, lessons: lessons.replace("team;last_out", "Team Work"), situations, stories })).toThrow(/snake_case/);
  });

  it("matches the row counts of the real CSVs", () => {
    const input = {
      ruleSources: read("rules/rule_sources.csv"),
      rulesFacts: read("rules/rules_facts.csv"),
      pitchRestRules: read("rules/pitch_rest_rules.csv"),
      coachingInsights: read("coaching/insights.csv"),
      lessons: read("coaching/lessons.csv"),
      situations: read("coaching/situations.csv"),
      stories: read("coaching/stories.csv"),
    };
    const { counts } = buildRulesSql(input);
    expect(counts).toEqual({
      sources: parseCsvRecords(input.ruleSources).length,
      facts: parseCsvRecords(input.rulesFacts).length,
      tiers: parseCsvRecords(input.pitchRestRules).length,
      insights: parseCsvRecords(input.coachingInsights).length,
      lessons: parseCsvRecords(input.lessons).length,
      situations: parseCsvRecords(input.situations).length,
      stories: parseCsvRecords(input.stories).length,
    });
  });

  it("keeps the committed data/rules.sql in sync with the CSVs", () => {
    const { sql } = buildRulesSql({
      ruleSources: read("rules/rule_sources.csv"),
      rulesFacts: read("rules/rules_facts.csv"),
      pitchRestRules: read("rules/pitch_rest_rules.csv"),
      coachingInsights: read("coaching/insights.csv"),
      lessons: read("coaching/lessons.csv"),
      situations: read("coaching/situations.csv"),
      stories: read("coaching/stories.csv"),
    });
    expect(read("rules.sql")).toBe(sql); // run `npm run rules:build` if this fails
  });
});

describe("docs/coaching", () => {
  it("keeps the committed Markdown pages in sync with the CSVs", () => {
    const docs = buildCoachingDocs({
      philosophy: LEARNING_PHILOSOPHY,
      lessons: read("coaching/lessons.csv"),
      situations: read("coaching/situations.csv"),
      stories: read("coaching/stories.csv"),
      insights: read("coaching/insights.csv"),
      rulesFacts: read("rules/rules_facts.csv"),
    });
    for (const [path, content] of Object.entries(docs)) {
      expect(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), path).toBe(content); // run `npm run rules:build`
    }
    expect(docs["docs/coaching/lessons.md"]).toContain('<a id="l001"></a>');
    expect(docs["docs/coaching/situations.md"]).toContain("F034 (usssa)");
  });
});
