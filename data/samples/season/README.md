# Demo season: Wrenmoor Wolves (synthetic)

**All of this data is synthetic.** The teams, players, numbers and games are invented for testing and demos. No real players, teams, dates or locations appear.

## The league

- Youth baseball, ages 14–18, in a summer recreational league.
- Games are 7 innings and can end early under the run rule or time limit.
- Courtesy runners are allowed for the pitcher and the catcher. A runner for an injured player is allowed only if both coaches agree before the game. Because the league is recreational, most coaches agree.
- A half-inning ends once the batting team scores 5 runs. The scorekeeper records it as "Half-inning ended by scorekeeper" with 3 outs.
- Teams may bat an extra hitter (EH).

The same rules are loaded as house rules for the event **Summer Rec League 14-18** (`data/migrations/005_summer_league_house_rules.sql`).

## The season

The focus team is **Wrenmoor Wolves (WRN)**. Their opponents are Tallowmere Tigers (TAL), Saltreach Sparrows (SAL), Brackenfell Bitterns (BRK), Quillhaven Cranes (QUI) and Dunmarrow Drakes (DUN).

WRN went 4–5–1 over 10 games, scoring 62 runs and allowing 64. Games are labeled G01–G10 and are not in date order.

Four kinds of input are included, matching what a coach could paste or upload for a post-game or season review:

| Path | Contents |
|---|---|
| `games_index.csv` | 10 games: source type, away/home, final score, line scores, WRN result |
| `rosters.csv` | All 6 teams: number, name, positions played |
| `play_by_play/G0x_play_by_play.txt` | G03, G04, G07, G09: one event per line (half-inning, event, pitch sequence, description, outs, score), with a line score at the end |
| `scorebooks/scorebook_plate_appearances.csv` | G01, G02, G05, G06, G08, G10: every plate appearance (inning, result, scoring code, out number, run number, ball and strike pitch numbers, base-path notes) |
| `scorebooks/scorebook_lineups.csv` | Batting order, positions and in-game position changes |
| `scorebooks/scorebook_grids.md` | Readable batter-by-inning grids with line scores |
| `season_stats/wrenmoor_wolves_season_stats.csv` | 174-column season export (batting, pitching, fielding) with a glossary |
| `situational/team_situational_batting.csv` | Team splits by game state |
| `situational/player_situational_batting_RISP.csv` | Runners-in-scoring-position splits by player |

## What the season teaches

- **Called third strikes.** 89 strikeouts in 290 plate appearances, 39 of them looking. This points to a two-strike approach and treating the zone as a hit zone.
- **Patient hitters.** A .452 on-base percentage against a .288 average, with 54 walks. That's a strength; the message is "selective early, aggressive in the hit zone".
- **Pressure at-bats.** .361 with runners in scoring position.
- **Baserunning.** 52 steals, 9 caught stealing.
- **Big innings against.** Opponents scored 4–5 runs in a single inning in 5 of the 10 games. With 25 errors and 15 wild pitches, the lesson is the next-play mindset after a mistake.
- **Rule moments.** Dropped third strikes (batter thrown out at first), a balk (G09), an out on offensive interference (G03), the 5-run cap, run-rule endings, courtesy runners and the EH.
- **One hard season for one player.** A player went 0-for-16 with 15 strikeouts. Team reviews never single out a player; a private question about that player gets the "your value isn't your stat line" lesson.

## Deliberate rough edges

These files keep the inconsistencies that real scorekeeping produces, so the app's checks have something to catch:

1. Two WRN players and two DUN players originally shared numbers; the numbers here are unique.
2. In the team situational table, 11 of 14 rows have PA ≠ AB + BB + HBP + SAC + SF (for example, "Tied game" shows PA 44 against 51 from its components).
3. In the RISP table, PA ≠ components for 2 players and the team row, and player AB sums to 99 against the team's 100.
4. Situational splits sum to the season's 290 PA, but to 234 AB (season: 222) and 86 SO (season: 89).
5. G03 ends with 2 outs in the bottom of the 5th (run-rule finish).
6. G05: the home team batted in the bottom of the 5th while leading.
7. G08: one half-inning scored 6 runs, more than the 5-run cap.
8. The season stats show only 1 pitching loss across 5 team losses and 1 tie.

Six scorebook plate appearances have no result because the half-inning or game ended during the at-bat. They are marked `PA incomplete`. Scorebook strikeouts looking are coded `Kc`.

## Checks that pass

- Batting: H = 1B + 2B + 3B + HR, TB, PA = AB + BB + HBP + SAC + SF + CI and AVG agree for every player and the totals.
- Pitching: innings sum to 57.1 (172 outs), and the other counting columns sum to the totals.
- Play-by-play: runs by inning sum to the final score, and every completed half-inning has 3 outs.
- WRN runs across all 10 games total 62 scored and 64 allowed, matching the season file.
