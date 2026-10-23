import { z } from "zod";

const RoleSchema = z.enum(["parent", "coach", "umpire", "player"]);
const SportSchema = z.enum(["baseball", "softball"]);
const CallTypeSchema = z.enum(["judgment", "rule", "mixed", "pending"]);

// A cited rule/source row, as it would come back from Zetaris.
const SourceSchema = z.object({
  table: z.string(),
  id: z.string(),
  source_url: z.string().url(),
  verified: z.boolean(),
  rule_ref: z.string().nullable().optional(),
  edition: z.string().nullable().optional(),
  synthetic: z.boolean().optional(),
});

const WhatHappenedSchema = z.object({
  summary: z.string().min(1),
  sources: z.array(z.string()),
});

const ChannelSchema = z.object({
  who: z.string().min(1),
  how: z.string().min(1),
});

const ImprovementPlanSchema = z.object({
  individual: z.array(z.string()),
  team: z.array(z.string()),
  at_home: z.array(z.string()),
});

export const SituationRequestSchema = z.object({
  question: z.string().min(1),
  role: RoleSchema,
  sport: SportSchema,
  sanction: z.string().min(1),
  age: z.coerce.number().int().nonnegative(),
  edition: z.string().optional(),
  event_name: z.string().optional(),
});

export const SituationAnswerSchema = z.object({
  what_happened: WhatHappenedSchema,
  call_type: CallTypeSchema,
  call_type_rationale: z.string().min(1),
  channel: ChannelSchema,
  teachable_moment: z.string().min(1),
  improvement_plan: ImprovementPlanSchema,
  confidence: z.coerce.number().min(0).max(1),
  sources: z.array(SourceSchema),
  missing_facts: z.array(z.string()),
  trace_id: z.string().min(1),
  /** Deterministic pitch-rest result, when one was computed. */
  computation: z.record(z.unknown()).nullable().optional(),
  draft_data: z.boolean().optional(),
  /** Which path answered: ruling (RulesAgent) or development/equipment/general (DevelopmentAgent). */
  intent: z.enum(["ruling", "development", "equipment", "general"]).optional(),
  /** Development path: the one next step DevelopmentAgent chose. */
  focus: z.string().optional(),
  /** The life lesson, applied to this moment, and the lessons it came from (our own words). */
  life_lesson: z
    .object({
      text: z.string(),
      lessons: z.array(z.object({ id: z.string(), title: z.string(), principle: z.string() })),
    })
    .optional(),
  /** Game situations: how offense and defense should react (from the situations table). */
  situations: z
    .array(z.object({ id: z.string(), name: z.string(), offense: z.string(), defense: z.string(), common_mistakes: z.string().nullable() }))
    .optional(),
  /** A real coaching moment from the team, shown as written (anonymized). */
  story: z.object({ id: z.string(), title: z.string(), story: z.string() }).optional(),
  /** What the critique loop did: drafts reviewed and anything left unresolved. */
  review: z
    .object({
      drafts: z.number().int(),
      passed: z.boolean(),
      unresolved_issues: z.array(z.string()),
    })
    .optional(),
});

export type SituationRequest = z.infer<typeof SituationRequestSchema>;
export type SituationAnswer = z.infer<typeof SituationAnswerSchema>;
