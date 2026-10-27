/**
 * The Zetaris schemastore views behind the DiamondAgentIQ Knowledge data mart.
 * `npm run zetaris:views` creates them (idempotent); the mart itself is built
 * from these views in the Zetaris UI (docs/zetaris-mart.md).
 */
export const VIEW_CONTAINER = "diq";

export const MART_VIEW_SQL: Record<string, string> = {
  cited_rules:
    "SELECT f.fact_code, f.sport, f.sanction, f.division, f.age_min, f.age_max, f.topic, f.fact_key, f.fact_value, f.unit, f.rule_ref, f.call_type, f.summary, f.verified, f.verified_by, s.source_id, s.title AS source_title, s.url AS source_url, s.edition FROM diq_pg.rules_facts f JOIN diq_pg.rule_sources s ON f.source_id = s.source_id",
  situation_playbook:
    "SELECT t.situation_code, t.name, t.topic, t.bases, t.outs, t.offense, t.defense, t.common_mistakes, t.rule_fact_codes, t.lesson_codes, t.verified, s.url AS source_url, s.title AS source_title FROM diq_pg.coaching_situations t JOIN diq_pg.rule_sources s ON t.source_id = s.source_id",
  lesson_library:
    "SELECT l.lesson_code, l.title, l.principle, l.life_lesson, l.for_player, l.for_coach, l.for_parent, l.for_umpire, l.tags, l.verified, s.url AS source_url, s.title AS source_title FROM diq_pg.coaching_lessons l JOIN diq_pg.rule_sources s ON l.source_id = s.source_id",
  coaching_tips:
    "SELECT c.insight_code, c.topic, c.sport, c.age_min, c.age_max, c.audience, c.situation, c.insight, c.why, c.try_this, c.source_id, c.verified, s.url AS source_url, s.title AS source_title FROM diq_pg.coaching_insights c JOIN diq_pg.rule_sources s ON c.source_id = s.source_id",
};

export function createViewSql(view: string): string {
  const body = MART_VIEW_SQL[view];
  if (!body) throw new Error(`Unknown mart view: ${view}`);
  return `CREATE SCHEMASTORE VIEW ${view} WITH CONTAINER ${VIEW_CONTAINER} AS (${body})`;
}
