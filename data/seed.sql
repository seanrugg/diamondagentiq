-- SYNTHETIC DEMO DATA ONLY: a tournament house rule, drills, and one fictional
-- game. No real players, teams, dates or locations. Rule facts live in
-- data/rules/*.csv (loaded via data/rules.sql).

-- Rule facts, sources and pitch-rest tiers now come from data/rules/*.csv
-- via data/rules.sql (npm run rules:build). They are not seeded here.

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
