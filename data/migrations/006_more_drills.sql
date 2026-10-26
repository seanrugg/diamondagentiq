-- More drills: older players (13-18), fielding and throwing (errors), throwing
-- strikes (walks) and base running, so post-game priorities have drills for
-- every age the demo league covers. Written by the team in our own words.
-- Idempotent: each drill is inserted only if no drill has that title.
-- Loaded on a fresh volume (docker-compose initdb), in SAMPLE_MODE, and by `npm run rules:load`.

INSERT INTO drills (skill, title, description, age_min, age_max, setting, equipment, safety_notes, reviewed)
SELECT v.skill, v.title, v.description, v.age_min, v.age_max, v.setting, v.equipment, v.safety_notes, v.reviewed
FROM (VALUES
  (
    'two_strike_hitting', 'Batting practice from 0-2',
    'Every hitter starts each round with an 0-2 count called out loud. Choke up, widen the zone and shorten the swing. The goal is hard contact or a foul ball, not a pull. Five pitches a round, then rotate.',
    13, 18, 'team', 'bats, balls, L-screen, helmets',
    'Pitcher throws from behind an L-screen. Helmets on in the cage. One hitter at a time; others wait outside the swing area.',
    FALSE
  ),
  (
    'fielding', 'Routine ground ball: field, set, throw',
    'Coach rolls or hits routine ground balls. The fielder gets in front, fields the ball out front with two hands, sets the feet toward the target and throws. Count clean plays out of ten; a rushed or wild throw does not count.',
    8, 18, 'team', 'gloves, balls, a base or target',
    'Start with rolled balls for newer players and softer training balls if needed. Keep fielders spaced so no one stands in a throwing lane.',
    FALSE
  ),
  (
    'fielding', 'First base: catch the throw',
    'Infielders throw to first at 60 to 70 percent, then full speed. The first baseman finds the base, stretches toward the throw and works on smothering short hops. Mix in throws to either side.',
    10, 18, 'team', 'gloves, balls, a base',
    'Throwers start at a short distance. No throw until the receiver is set and looking. The first baseman uses a glove that fits.',
    FALSE
  ),
  (
    'throwing', 'Partner throwing to the chest',
    'Partners throw to each other''s chest at a set distance; a throw that reaches the chest scores a point. Step toward the target and follow through. Add distance only after 8 of 10 throws are on target.',
    8, 18, 'team', 'gloves, balls',
    'Everyone throws in the same direction from one line. Warm up first. Stop if anyone has arm pain.',
    FALSE
  ),
  (
    'throwing_strikes', 'Bullpen: first-pitch strikes',
    'In a short bullpen, the catcher calls a new hitter every few pitches and the first pitch to each is a fastball aimed at the middle of the zone. Track first-pitch strikes out of 15.',
    11, 18, 'individual', 'balls, catcher''s gear, a plate',
    'Count every bullpen pitch toward the day''s workload under your league''s pitch-count rules (Pitch Smart in rec leagues). Stop if there is arm pain. No bullpen the day after a long outing.',
    FALSE
  ),
  (
    'throwing_strikes', 'Three-target command',
    'From flat ground at about 75 percent effort, the catcher sets up low and away, low and in, then down the middle; three pitches to each target. Note which target is hardest and start there next time.',
    11, 18, 'individual', 'balls, catcher''s gear',
    'Flat ground only, no mound. Count the pitches toward the day''s workload. Catcher wears full gear.',
    FALSE
  ),
  (
    'baserunning', 'Run through first',
    'The batter hits off a tee, drops the bat and sprints through a cone set three to four steps past first base, then looks right toward foul ground for the ball and returns to the base.',
    7, 18, 'team', 'tee, bat, balls, a base, a cone',
    'The bat is dropped, never thrown. Runners go one at a time. Use a double or breakaway base where available.',
    FALSE
  ),
  (
    'baserunning', 'Fly or ground? Base-running reads',
    'Runners on first and second. The coach calls the outs, then tosses a fly ball or rolls a ground ball. With fewer than two outs runners go partway on fly balls and read; forced runners run on ground balls; with two outs everyone runs on contact. Talk through each decision after the rep.',
    8, 18, 'team', 'balls, bases, helmets',
    'Runners wear helmets. Fielders and runners stay in separate lanes. No sliding until it has been taught.',
    FALSE
  ),
  (
    'catching', 'Blocking balls in the dirt',
    'From a crouch, the catcher drops to the knees, chin down and glove between the legs, and keeps the ball in front. Start with rolled balls, then short tosses into the dirt from a few feet away.',
    11, 18, 'individual', 'catcher''s gear, soft training balls',
    'Full catcher''s gear, including a cup. Start with soft training balls and short, slow tosses.',
    FALSE
  )
) AS v(skill, title, description, age_min, age_max, setting, equipment, safety_notes, reviewed)
WHERE NOT EXISTS (SELECT 1 FROM drills d WHERE d.title = v.title);
