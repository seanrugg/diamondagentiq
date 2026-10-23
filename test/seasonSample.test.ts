import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleSql } from "../src/adapters/sampleData.js";

const dir = new URL("../data/samples/season/", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), "utf8");

describe("demo season (synthetic)", () => {
  it("games index totals match the season: 4-5-1, 62 scored, 64 allowed", () => {
    const [header, ...rows] = read("games_index.csv").trim().split(/\r?\n/);
    const cols = (header ?? "").split(",");
    const at = (r: string[], name: string) => r[cols.indexOf(name)] ?? "";
    let scored = 0;
    let allowed = 0;
    const record = { W: 0, L: 0, T: 0 };
    for (const line of rows) {
      const r = line.split(",");
      const away = Number(at(r, "away_R"));
      const home = Number(at(r, "home_R"));
      const wolvesAway = at(r, "away") === "Wrenmoor Wolves";
      scored += wolvesAway ? away : home;
      allowed += wolvesAway ? home : away;
      record[at(r, "focus_team_result") as "W" | "L" | "T"] += 1;
    }
    expect(rows).toHaveLength(10);
    expect({ scored, allowed, ...record }).toEqual({ scored: 62, allowed: 64, W: 4, L: 5, T: 1 });
  });

  it("ships four play-by-play games and six team rosters", () => {
    expect(readdirSync(new URL("play_by_play/", dir)).sort()).toEqual([
      "G03_play_by_play.txt",
      "G04_play_by_play.txt",
      "G07_play_by_play.txt",
      "G09_play_by_play.txt",
    ]);
    const teams = new Set(read("rosters.csv").trim().split(/\r?\n/).slice(1).map((l) => l.split(",")[0]));
    expect(teams.size).toBe(6);
  });

  it("loads the league house rules once each in sample mode", async () => {
    const { data } = await sampleSql(
      "SELECT topic, synthetic FROM house_rules WHERE event_name = 'Summer Rec League 14-18' ORDER BY topic",
    );
    expect(data).toEqual([
      ["courtesy_runner", "true"],
      ["extra_hitter", "true"],
      ["game_length", "true"],
      ["inning_run_cap", "true"],
    ]);
  });
});
