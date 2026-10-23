-- SYNTHETIC DEMO DATA: house rules for the demo summer recreational league
-- (youth baseball, ages 14-18) used by data/samples/season/. Written by the
-- team from how the league plays, not quoted from any rulebook.
-- Idempotent: each rule is inserted only if that event/topic is missing.
-- Loaded on a fresh volume (docker-compose initdb), in SAMPLE_MODE, and by `npm run rules:load`.

INSERT INTO house_rules (event_name, sanction, sport, age_group, topic, rule_text, source_file, section, overrides_fact_key, synthetic)
SELECT * FROM (VALUES
  (
    'Summer Rec League 14-18', NULL::text, 'baseball', '14-18', 'game_length',
    'Summer Rec League 14-18 house rule (synthetic): regulation games are 7 innings. Games can end early under the league run rule or time limit.',
    'synthetic://summer-rec-14-18/house-rules.txt', 'Game length', NULL::text, TRUE
  ),
  (
    'Summer Rec League 14-18', NULL::text, 'baseball', '14-18', 'courtesy_runner',
    'Summer Rec League 14-18 house rule (synthetic): courtesy runners are allowed for the pitcher and the catcher. A courtesy runner for an injured player is allowed only if both coaches agree before the game; because the league is recreational, most coaches agree.',
    'synthetic://summer-rec-14-18/house-rules.txt', 'Courtesy runners', NULL::text, TRUE
  ),
  (
    'Summer Rec League 14-18', NULL::text, 'baseball', '14-18', 'inning_run_cap',
    'Summer Rec League 14-18 house rule (synthetic): a half-inning ends once the batting team scores 5 runs. The scorekeeper records the half-inning as complete (3 outs).',
    'synthetic://summer-rec-14-18/house-rules.txt', 'Run cap', NULL::text, TRUE
  ),
  (
    'Summer Rec League 14-18', NULL::text, 'baseball', '14-18', 'extra_hitter',
    'Summer Rec League 14-18 house rule (synthetic): teams may bat an extra hitter (EH), so more players get at-bats.',
    'synthetic://summer-rec-14-18/house-rules.txt', 'Lineup', NULL::text, TRUE
  )
) AS r(event_name, sanction, sport, age_group, topic, rule_text, source_file, section, overrides_fact_key, synthetic)
WHERE NOT EXISTS (
  SELECT 1 FROM house_rules h WHERE h.event_name = r.event_name AND h.topic = r.topic
);
