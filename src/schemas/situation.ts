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
});

export type SituationRequest = z.infer<typeof SituationRequestSchema>;
export type SituationAnswer = z.infer<typeof SituationAnswerSchema>;
