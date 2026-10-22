-- DRAFT SEED ONLY. Rule numbers and rest days are unverified working copies
-- for local development. Confirm against the governing body's current official
-- rules before any on-field use. Summaries are our own words, not rulebook text.

-- Little League baseball pitch-count rest tiers (10U–14U), draft, verified=false.
-- Source page: Little League playing rules (not a quotation of the chart).
INSERT INTO pitch_rest_rules (
  sanction, sport, age_min, age_max, pitches_min, pitches_max, rest_days,
  edition, source_url, verified
) VALUES
  ('little_league', 'baseball', 9, 10, 1, 20, 0, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 9, 10, 21, 35, 1, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 9, 10, 36, 50, 2, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 9, 10, 51, 65, 3, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 9, 10, 66, 75, 4, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 11, 12, 1, 20, 0, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 11, 12, 21, 35, 1, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 11, 12, 36, 50, 2, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 11, 12, 51, 65, 3, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 11, 12, 66, 85, 4, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 13, 14, 1, 20, 0, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 13, 14, 21, 35, 1, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 13, 14, 36, 50, 2, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 13, 14, 51, 65, 3, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE),
  ('little_league', 'baseball', 13, 14, 66, 95, 4, '2026 draft (unverified)', 'https://www.littleleague.org/playing-rules/', FALSE);

-- USA Softball fastpitch: no baseball-style pitch-count rest chart found in the
-- official playing rules for this seed, so pitch_rest_rules stays empty for softball.
INSERT INTO rules_facts (
  sport, sanction, age_min, age_max, edition, topic, fact_key, fact_value, unit,
  summary, source_url, verified, notes
) VALUES
  (
    'softball',
    'usa_softball',
    8,
    18,
    '2026 draft (unverified)',
    'pitch_count',
    'official_pitch_rest_chart',
    'none',
    NULL,
    'Draft: USA Softball fastpitch playing rules do not appear to publish a baseball-style pitch-count rest chart. Event hosts may still add their own limits. Confirm on the current official rules page before relying on this.',
    'https://www.usasoftball.com/official-rules/',
    FALSE,
    'DRAFT unverified. No softball rows were inserted into pitch_rest_rules.'
  ),
  (
    'baseball',
    'little_league',
    9,
    14,
    '2026 draft (unverified)',
    'pitch_count',
    'pitch_rest_chart',
    'see pitch_rest_rules',
    'pitches_and_rest_days',
    'Draft: Little League baseball uses age-banded pitch counts and calendar-day rest. Thresholds in pitch_rest_rules are a working copy only and must be checked against the official rules.',
    'https://www.littleleague.org/playing-rules/',
    FALSE,
    'DRAFT unverified.'
  ),
  (
    'baseball',
    'little_league',
    8,
    16,
    '2026 draft (unverified)',
    'obstruction',
    'call_type',
    'mixed',
    NULL,
    'Draft: obstruction is mixed — whether it occurred is a judgment call; once it is ruled, the award of bases follows the rule. This is a paraphrase, not rulebook language.',
    'https://www.littleleague.org/playing-rules/',
    FALSE,
    'DRAFT unverified. Occurrence = judgment; award = rule.'
  ),
  (
    'baseball',
    'little_league',
    8,
    16,
    '2026 draft (unverified)',
    'interference',
    'call_type',
    'rule_with_judgment',
    NULL,
    'Draft: interference is a rules-based out or penalty once the umpire decides the act happened. The act itself is judged; the result is prescribed. Paraphrase only.',
    'https://www.littleleague.org/playing-rules/',
    FALSE,
    'DRAFT unverified.'
  ),
  (
    'baseball',
    'little_league',
    8,
    16,
    '2026 draft (unverified)',
    'infield_fly',
    'call_type',
    'rule_with_judgment',
    NULL,
    'Draft: infield fly can be invoked only when the situation matches the rule (force situation, infielder can catch it with ordinary effort). Ordinary effort is judgment; the batter-out result is the rule. Paraphrase only.',
    'https://www.littleleague.org/playing-rules/',
    FALSE,
    'DRAFT unverified.'
  ),
  (
    'baseball',
    'little_league',
    8,
    16,
    '2026 draft (unverified)',
    'uncaught_third_strike',
    'call_type',
    'rule',
    NULL,
    'Draft: an uncaught third strike can let the batter try for first when first base is open or when there are two outs. Whether the pitch was caught is judged; when the batter may run is set by the rule. Paraphrase only.',
    'https://www.littleleague.org/playing-rules/',
    FALSE,
    'DRAFT unverified.'
  ),
  (
    'softball',
    'usa_softball',
    8,
    18,
    '2026 draft (unverified)',
    'look_back',
    'call_type',
    'rule_with_judgment',
    NULL,
    'Draft: the softball look-back rule restricts a runner once the pitcher has the ball in the circle. Whether the pitcher is in the circle with possession is judged; the runner’s options and outs follow the rule. Paraphrase only.',
    'https://www.usasoftball.com/official-rules/',
    FALSE,
    'DRAFT unverified.'
  );

-- Synthetic tournament sheet that is stricter than the sanction rest chart.
INSERT INTO house_rules (
  event_name, sanction, sport, age_group, topic, rule_text, source_file, section,
  overrides_fact_key, synthetic
) VALUES (
  'Fall Classic 12U',
  'little_league',
  'baseball',
  '12U',
  'pitch_rest',
  'Fall Classic 12U house rule (synthetic, written by the event, not a sanction quotation): after any outing of 21 or more pitches, add one extra calendar day of rest beyond the sanction pitch-count chart before that pitcher may throw in a game again.',
  'synthetic://fall-classic-12u/house-rules.txt',
  'Pitching rest',
  'pitch_rest_chart',
  TRUE
);

INSERT INTO drills (
  skill, title, description, age_min, age_max, setting, equipment, safety_notes, reviewed
) VALUES
  (
    'two_strike_hitting',
    'Tee: two-strike outside corner',
    'From a tee on the outer half, hitters take a slightly shorter two-strike swing and drive the ball the other way. Five quality reps, then switch.',
    10,
    14,
    'individual',
    'tee, balls, bat, net',
    'Set the net so missed balls cannot reach a walkway. Helmet on for every swing.',
    FALSE
  ),
  (
    'two_strike_hitting',
    'Tee: two-strike low pitch',
    'Tee at the bottom of the zone. Hitters stay on the back hip, match the low plane, and keep the ball out of the air. No upward chop.',
    10,
    14,
    'home',
    'tee, balls, bat',
    'Give the hitter a clear cage or fence. Do not kneel in the swing path to set the tee.',
    FALSE
  ),
  (
    'two_strike_hitting',
    'Soft toss: two-strike outside corner',
    'Partner kneels off to the side and tosses to the outer half. Hitter works a two-strike approach: later start, compact finish, ball to the opposite field.',
    10,
    14,
    'team',
    'balls, bats, net, helmets',
    'Tosser stays outside the swing arc and wears a helmet. Stop the round if tosses drift toward the hitter’s hands.',
    FALSE
  ),
  (
    'two_strike_hitting',
    'Soft toss: two-strike low pitches',
    'Short-hop or low tosses at the knees. Two-strike goal is contact through the bottom of the zone, not a lift. Alternate sides of the plate.',
    10,
    14,
    'team',
    'balls, bats, net, helmets',
    'Keep tosses out of the hitter’s feet. Helmets for hitter and tosser.',
    FALSE
  ),
  (
    'baserunning',
    'First-to-third reads',
    'Runner at first on a ball in the outfield gap. Read the fielder’s angle and the cutoff, then decide stay-at-second vs. third without watching the ball bounce twice.',
    10,
    14,
    'team',
    'bases, balls, gloves, helmets',
    'No slides into unprotected coaches. Clear the rundown lane before the next rep.',
    FALSE
  ),
  (
    'baserunning',
    'Tag-up reads',
    'Fly ball to the outfield with a runner at third (and optionally second). Freeze, find the catch, leave on the first downward move of the glove, and beat a firm throw home.',
    10,
    14,
    'team',
    'bases, balls, gloves, helmets',
    'Use a breakaway home plate or a pad if sliding. Catcher must wear full gear if blocking the plate in this drill.',
    FALSE
  ),
  (
    'catching',
    'Low-zone framing holds',
    'From a kneeling or receiving stance, catcher tracks low strikes, beats the ball to the bottom of the zone, and holds a quiet glove for one beat. No stabbing.',
    10,
    14,
    'individual',
    'catcher’s glove, balls, tennis balls or weighted balls optional',
    'Start with tennis balls if the catcher is new to framing. Do not mix live bats in this station.',
    FALSE
  ),
  (
    'pitcher_recovery',
    'Between-outing recovery circuit',
    'Light movement, band work, and a short catch progression the day after a high-pitch outing. Stop at any sharp elbow or shoulder pain and check rest rules before the next live inning.',
    10,
    14,
    'individual',
    'bands, baseballs, open space',
    'This is recovery, not a bullpen. No max-effort throws. Pair with the pitcher’s remaining rest days.',
    FALSE
  );

INSERT INTO games (
  id, home_team, away_team, game_date, venue, age_group, sanction, sport, synthetic
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Fall Classic 12U Navy',
  'Fall Classic 12U Gray',
  DATE '2026-10-16',
  'Synthetic Field 1',
  '12U',
  'little_league',
  'baseball',
  TRUE
);

INSERT INTO pitcher_appearances (
  game_id, pitcher_name, team, pitches, game_date, synthetic
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Alex Rivera (synthetic)',
  'Fall Classic 12U Navy',
  68,
  DATE '2026-10-16',
  TRUE
);
