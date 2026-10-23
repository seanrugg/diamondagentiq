import { z } from "zod";

const n = z.coerce.number().int().nonnegative();
const nullableN = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().nonnegative().nullable());

export const BattingLineSchema = z.object({
  player: z.string().min(1),
  ab: n, r: n, h: n, rbi: n, bb: n, so: n,
});

export const PitchingLineSchema = z.object({
  player: z.string().min(1),
  /** Innings as printed: "4.0", "3.2" (= 3 and 2/3). */
  ip: z.coerce.string(),
  h: n, r: n, er: n, bb: n, so: n,
  pitches: nullableN,
});

const RheSchema = z.object({ r: n, h: n, e: n });

/** What ScorebookAgent reads off a box score. Numbers only as printed; no math. */
export const BoxScoreSchema = z.object({
  away_team: z.string().min(1),
  home_team: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  event: z.string().nullable().default(null),
  line_score: z.object({
    away: z.array(n),
    home: z.array(n),
    away_rhe: RheSchema,
    home_rhe: RheSchema,
  }),
  /** The team whose batting and pitching lines are shown. */
  stats_team: z.string().min(1),
  batting: z.array(BattingLineSchema).min(1),
  batting_totals: BattingLineSchema.omit({ player: true }).nullable().default(null),
  pitching: z.array(PitchingLineSchema).min(1),
  pitching_totals: PitchingLineSchema.omit({ player: true }).nullable().default(null),
});

export type BoxScore = z.infer<typeof BoxScoreSchema>;
export type BattingLine = z.infer<typeof BattingLineSchema>;
export type PitchingLine = z.infer<typeof PitchingLineSchema>;

export const GameReviewRequestSchema = z.object({
  /** data:image/png;base64,... or data:image/jpeg;base64,... */
  image: z.string().regex(/^data:image\/(png|jpe?g|webp);base64,/).optional(),
  /** Or the box score pasted as text. */
  text: z.string().max(20_000).optional(),
  role: z.enum(["parent", "coach", "umpire", "player"]).default("coach"),
  sport: z.enum(["baseball", "softball"]),
  sanction: z.string().min(1),
  age: z.coerce.number().int().min(4).max(18),
  team: z.string().max(60).optional(),
}).refine((r) => Boolean(r.image) !== Boolean(r.text), { message: "Send either an image or text, not both" });

export type GameReviewRequest = z.infer<typeof GameReviewRequestSchema>;

export const GameReviewAnswerSchema = z.object({
  box_score: BoxScoreSchema,
  read: z.object({ reads: z.number().int(), issues: z.array(z.string()) }),
  stats: z.record(z.unknown()),
  pitcher_rest: z.array(z.object({ player: z.string(), pitches: z.number(), rest_days: z.number().nullable(), eligible_again: z.string().nullable(), note: z.string().nullable() })),
  headline: z.string(),
  what_decided_it: z.array(z.string()),
  strengths: z.array(z.string()),
  priorities: z.array(z.object({
    title: z.string(),
    why: z.string(),
    drills: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), setting: z.string(), safety_notes: z.string().nullable() })),
    insights: z.array(z.object({ id: z.string(), insight: z.string(), source_url: z.string().nullable(), verified: z.boolean() })),
  })),
  lesson: z.object({ id: z.string(), title: z.string(), principle: z.string(), life_lesson: z.string() }).nullable(),
  team_talk: z.string(),
  at_home: z.array(z.string()),
  sources: z.array(z.object({ table: z.string(), id: z.string(), source_url: z.string().nullable(), verified: z.boolean() })),
  confidence: z.number().min(0).max(1),
  review: z.object({ drafts: z.number().int(), passed: z.boolean(), unresolved_issues: z.array(z.string()) }),
  memory: z.object({ recalled: z.array(z.object({ id: z.string(), content: z.string(), relevance: z.number(), confidence: z.number() })), used: z.array(z.string()), saved: z.array(z.string()) }).optional(),
  synthetic_input: z.boolean(),
  trace_id: z.string(),
});
export type GameReviewAnswer = z.infer<typeof GameReviewAnswerSchema>;
