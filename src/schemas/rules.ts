import { z } from "zod";

/** What the RulesAgent model must return after its lookups. */
export const RulesModelOutputSchema = z.object({
  facts_used: z
    .array(
      z.object({
        table: z.enum(["rules_facts", "house_rules"]),
        id: z.string().min(1),
      }),
    )
    .default([]),
  applies_pitch_rest: z.boolean(),
  house_rule_adjustment: z
    .discriminatedUnion("kind", [
      z.object({
        house_rule_id: z.string().min(1),
        kind: z.literal("add_days"),
        min_pitches: z.coerce.number().int().nonnegative(),
        days: z.coerce.number().int().positive(),
      }),
      z.object({
        house_rule_id: z.string().min(1),
        kind: z.literal("absolute"),
        rest_days: z.coerce.number().int().nonnegative(),
      }),
    ])
    .nullish(),
  summary: z.string().min(1),
  call_type_hint: z.enum(["judgment", "rule", "mixed"]),
  missing_facts: z.array(z.string()).default([]),
});

export type RulesModelOutput = z.infer<typeof RulesModelOutputSchema>;

export const RuleSourceSchema = z.object({
  table: z.enum(["rules_facts", "house_rules", "pitch_rest_rules"]),
  id: z.string(),
  rule_ref: z.string().nullable(),
  source_url: z.string().nullable(),
  edition: z.string().nullable(),
  verified: z.boolean(),
  synthetic: z.boolean(),
  /** rules_facts only: rule | judgment | mixed. */
  call_type: z.enum(["rule", "judgment", "mixed"]).nullable().optional(),
  /** Our own-words summary of the fact or house rule. */
  summary: z.string().nullable().optional(),
});

export type RuleSource = z.infer<typeof RuleSourceSchema>;

export const PitchRestComputationSchema = z.object({
  pitches: z.number().int(),
  age: z.number().int(),
  last_pitched_date: z.string(),
  game_date: z.string().nullable(),
  sanction_rest_days: z.number().int(),
  rest_days: z.number().int(),
  governing: z.enum(["sanction", "house_rule"]),
  conflict: z.boolean(),
  house_rule_id: z.string().nullable(),
  earliest_eligible_date: z.string(),
  eligible_on_game_date: z.boolean().nullable(),
});

export type PitchRestComputation = z.infer<typeof PitchRestComputationSchema>;

export type RulesResult =
  | {
      ok: true;
      summary: string;
      call_type_hint: "judgment" | "rule" | "mixed";
      sources: RuleSource[];
      computation: PitchRestComputation | null;
      draft_data: boolean;
      missing_facts: string[];
    }
  | { ok: false; error: { message: string; attempts: number } };
