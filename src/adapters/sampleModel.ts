/**
 * SAMPLE_MODE stand-in for Nemotron: a deterministic, rule-based responder
 * that lets a judge with no Nightshift run the whole agent team from a fresh
 * clone. It is not a language model and its answers are plainer, but it is
 * not a replay either: every reply is built from the request in front of it
 * (the question, the rows the agent's queries returned, the computed results,
 * the menus code fetched), so the orchestration, SQL, calculators, critique
 * loop and memory all run for real. Answers are labeled as sample mode.
 *
 * generator() routes here only when SAMPLE_MODE=true.
 */
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";

export const SAMPLE_MODEL = "sample-offline (SAMPLE_MODE, no model)";

export type SampleReply = { content: string | null; toolCalls: ChatCompletionMessageToolCall[] };

type Msg = ChatCompletionMessageParam;

function textOf(m: Msg): string {
  const c = (m as { content?: unknown }).content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("\n");
  return "";
}
const hasImage = (messages: Msg[]) => messages.some((m) => Array.isArray((m as { content?: unknown }).content) && ((m as { content: unknown[] }).content).some((p) => (p as { type?: string }).type === "image_url"));
const userText = (messages: Msg[]) => messages.filter((m) => m.role === "user").map(textOf).join("\n");
const systemText = (messages: Msg[]) => messages.filter((m) => m.role === "system").map(textOf).join("\n");
const line = (text: string, label: string) => (text.match(new RegExp(`^\\s*-?\\s*${label}:\\s*(.*)$`, "mi"))?.[1] ?? "").trim();
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));
const overlap = (a: Set<string>, b: string) => [...words(b)].filter((w) => a.has(w)).length;
const json = (v: unknown): SampleReply => ({ content: JSON.stringify(v), toolCalls: [] });

// Balls and strikes, not "hit the ball".
const JUDGMENT_WORDS = /\b(strikes?|strike-three|strike three|balls and strikes|ball four|outside|inside|called|safe|umpire|obstruct|interfer|missed a call)\b/i;
// "Pitches" alone isn't a rule question ("hit by pitches"); a count or rest is.
const RULE_WORDS = /\b(\d+\s*pitches|pitch count|eligible|rest days?|innings|protest|balk|dropped third|uncaught|courtesy runner|legal|rule|dead ball|how many outs|infield fly)\b/i;

// ---------- ContextAgent ----------
function context(messages: Msg[]): SampleReply {
  const t = userText(messages);
  const question = line(t, "question");
  const q = question.toLowerCase();
  const intent = /\b(bat|glove|helmet|cleats|equipment)\b/.test(q) && !/pitch/.test(q)
    ? "equipment"
    : /(\d+\s*pitches|\bpitch count|\beligible|\brest days|\bdropped third|\buncaught|\bprotest|\bbalk|\binfield fly|\bhouse rule|\ballowed to pitch|\bcan (he|she) pitch|\bhow many outs|\bhits? the runner|\bdead ball)/.test(q)
      ? "ruling"
      : /\b(struck out|strikeout|scared|confidence|error|lost|failure|help (him|her|me)|help with|blaming|handshake|0 for|worst|missed a call|yelled|swing|hit the ball|froze|nervous|throw|catch|field|practice)\b/.test(q)
        ? "development"
        : "general";
  const days = [...q.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday|today|tomorrow)\b/g)].map((m) => m[1]);
  const pitches = q.match(/(\d{1,3})\s*pitches/)?.[1];
  return json({
    intent,
    sport: line(t, "sport") === "softball" ? "softball" : "baseball",
    sanction: line(t, "sanction") || "little_league",
    age: Number(line(t, "age")) || 12,
    topic: question.slice(0, 80),
    entities: {
      ...(pitches ? { pitches: Number(pitches) } : {}),
      ...(days[0] ? { last_pitched_date: days[0] } : {}),
      ...(days[1] ? { game_date: days[1] } : pitches && /tomorrow/.test(q) ? { game_date: "tomorrow" } : {}),
    },
    missing_facts: [],
  });
}

// ---------- RulesAgent (tool calls, then the answer) ----------
function rulesTopics(q: string): string[] {
  if (/pitch/.test(q)) return ["pitch_count", "pitch_rest", "workload", "pitching"];
  if (/dropped third|uncaught/.test(q)) return ["uncaught_third_strike"];
  if (/protest|appeal/.test(q)) return ["protest", "appeal", "channel"];
  if (/obstruct|interfer|hits? the runner|runner .*hit by/.test(q)) return ["obstruction", "judgment"];
  if (/balk/.test(q)) return ["balk", "judgment"];
  return ["judgment", "channel", "conduct"];
}

function rules(messages: Msg[]): SampleReply {
  const t = userText(messages);
  const q = line(t, "question").toLowerCase();
  const sport = line(t, "sport") || "baseball";
  const sanction = (line(t, "sanction") || "little_league").replace(/[^a-z_]/g, "");
  const event = line(t, "event");
  const toolResults = messages.filter((m) => m.role === "tool").map(textOf);
  const call = (sql: string): SampleReply => ({
    content: null,
    toolCalls: [{ id: `sample-${toolResults.length + 1}`, type: "function", function: { name: "run_sql", arguments: JSON.stringify({ sql }) } }],
  });

  if (toolResults.length === 0) {
    const topics = rulesTopics(q).map((x) => `'${x}'`).join(", ");
    return call(`SELECT fact_code, topic, fact_key, call_type, rule_ref, summary FROM diq_pg.rules_facts WHERE sanction IN ('${sanction}', 'pitch_smart') AND sport IN ('${sport}', 'both') AND topic IN (${topics})`);
  }
  if (toolResults.length === 1 && event && event !== "(none)") {
    return call(`SELECT id, event_name, topic, rule_text FROM diq_pg.house_rules WHERE event_name = '${event.replace(/'/g, "''")}'`);
  }

  const rows = toolResults.flatMap((r) => { try { return JSON.parse(r) as Record<string, string | null>[]; } catch { return []; } });
  const facts = rows.filter((r) => r.fact_code).slice(0, 4);
  const house = rows.find((r) => r.id && r.rule_text);
  let adjustment: unknown = null;
  if (house?.rule_text) {
    const min = house.rule_text.match(/(\d+)\s+or more pitches/i)?.[1];
    const add = house.rule_text.match(/add (one|two|three|\d+) extra/i)?.[1];
    const n = add ? ({ one: 1, two: 2, three: 3 } as Record<string, number>)[add.toLowerCase()] ?? Number(add) : null;
    if (min && n) adjustment = { house_rule_id: house.id, kind: "add_days", min_pitches: Number(min), days: n };
  }
  const types = facts.map((f) => f.call_type);
  const hint = JUDGMENT_WORDS.test(q) && types.includes("rule") ? "mixed" : types.includes("judgment") && !types.includes("rule") ? "judgment" : "rule";
  const summary = facts.length
    ? `${facts.slice(0, 2).map((f) => f.summary).join(" ")}${house ? ` The event also has its own house rule on this.` : ""}`
    : "No rule in our data covers this exactly; it may be a judgment call for the umpire.";
  return json({
    facts_used: [...facts.map((f) => ({ table: "rules_facts", id: f.fact_code })), ...(house ? [{ table: "house_rules", id: house.id }] : [])],
    applies_pitch_rest: /"pitches":\s*\d+/.test(t),
    house_rule_adjustment: adjustment,
    summary,
    call_type_hint: hint,
    missing_facts: [],
  });
}

// ---------- DevelopmentAgent ----------
type MenuItem = { id: string; text: string };
function menu(t: string, header: string, idPattern: string): MenuItem[] {
  const start = t.indexOf(header);
  if (start < 0) return [];
  const rest = t.slice(start + header.length).split("\n").slice(1);
  const items: MenuItem[] = [];
  for (const l of rest) {
    if (!l.startsWith("- ")) break;
    const m = l.match(new RegExp(`^- (${idPattern})\\b\\s*(.*)$`));
    if (m?.[1]) items.push({ id: m[1], text: m[2] ?? "" });
  }
  return items;
}
const rank = (items: MenuItem[], q: Set<string>) => [...items].map((i) => ({ ...i, score: overlap(q, i.text) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

/** Plain-language synonyms so a question finds the right lesson or tip by word overlap. */
const EXPAND: [RegExp, string][] = [
  [/scared|afraid|fear|nervous/, "confidence mindset believe players struggling"],
  [/error|mistake/, "mistake error responsibility failure team"],
  [/lost|loss|losing/, "loss team failure"],
  [/struck out|strikeout/, "strikeout failure confidence plate coverage"],
  [/blam/, "blame mistake team responsibility"],
  [/handshake|rival|opponent/, "sportsmanship opponents respect handshake"],
  [/\d+\s*pitches|pitch count|\brest\b|\barm\b/, "pitch workload arm care depth pitching winning"],
  [/dropped third|uncaught/, "dropped third strike situation runner"],
  [/hits? the runner|hit by the ball|dead ball|how many outs/, "runner batted ball dead umpire control moment crew conflict yelling coaches"],
  [/umpire|call/, "umpire mistake human respect"],
  [/worst|0 for|value/, "value failure stat line"],
  [/swing|hit the ball|hit it|far|power/, "bat weight check heavy control size tee balance"],
  [/froze|frozen|taking|looking/, "two strike approach strike zone confidence"],
];
function expand(text: string): string {
  const t = text.toLowerCase();
  return `${text} ${EXPAND.filter(([re]) => re.test(t)).map(([, extra]) => extra).join(" ")}`;
}

function development(messages: Msg[]): SampleReply {
  const t = userText(messages);
  const question = t.match(/^Question \([a-z]+\): (.*)$/m)?.[1] ?? "";
  const q = words(expand(`${question} ${t.match(/Topic: (.*)$/m)?.[1] ?? ""}`));
  const lessons = rank(menu(t, "Lessons (philosophy):", "L\\d+"), q);
  const base = (/runner on (first|second|third)|bases loaded/i.exec(question)?.[0] ?? "").toLowerCase();
  const situations = rank(menu(t, "Situations (strategy):", "SIT\\d+"), q)
    .filter((s) => s.score >= 3 && (!base || s.text.toLowerCase().includes(base)));
  const stories = rank(menu(t, "Stories (real coaching moments):", "ST\\d+"), q).filter((s) => s.score >= 3);
  // Player tips and drills don't fit an umpire's question; the lesson's umpire angle does.
  const forUmpire = /^Question \(umpire\)/m.test(t);
  const insights = forUmpire ? [] : rank(menu(t, "Coaching insights:", "C\\d+"), q).filter((i, n) => i.score >= (n === 0 ? 1 : 2));
  const drills = forUmpire ? [] : rank(menu(t, "Drills:", "[0-9a-f-]{8,}"), q).filter((d) => d.score > 0);
  const picks = lessons.slice(0, lessons[1] && lessons[1].score > 0 ? 2 : 1);
  const topic = insights[0]?.text.match(/^\[([a-z_]+);/)?.[1]?.replace(/_/g, " ");
  const focus = topic ?? picks[0]?.text.match(/"(.*?)"/)?.[1] ?? "one small step this week";
  return json({
    lesson_ids: picks.map((l) => l.id),
    situation_ids: situations.slice(0, 1).map((s) => s.id),
    story_id: stories[0]?.id ?? null,
    insight_ids: insights.slice(0, 2).map((i) => i.id),
    drill_ids: drills.slice(0, 1).map((d) => d.id),
    focus,
    call_type_hint: JUDGMENT_WORDS.test(question) ? "judgment" : RULE_WORDS.test(question) ? "rule" : "coaching",
  });
}

// ---------- CallTypeAgent ----------
function callType(messages: Msg[]): SampleReply {
  const t = userText(messages);
  const question = t.match(/^Question \([a-z]+\): (.*)$/m)?.[1] ?? "";
  const judgment = JUDGMENT_WORDS.test(question);
  const rule = RULE_WORDS.test(question) || /\[rule\]/.test(t);
  const call_type = judgment && rule ? "mixed" : judgment ? "judgment" : rule ? "rule" : "coaching";
  const rationale = {
    coaching: "No umpire call or rule is in question here: this is about skills, confidence and the next step.",
    judgment: "What happened on the field (balls and strikes, safe or out) is the umpire's judgment; it can't be protested.",
    rule: "A written rule decides this once the facts are known.",
    mixed: "The umpire's judgment decides what happened; a written rule then sets what follows.",
  }[call_type];
  return json({ call_type, rationale, judgment_parts: judgment ? ["what the umpire saw"] : [], rule_parts: rule ? ["the written rule"] : [] });
}

// ---------- CoachingAgent ----------
function coaching(messages: Msg[]): SampleReply {
  const t = userText(messages);
  const role = t.match(/^Role: (\w+)/m)?.[1] ?? "parent";
  const question = t.match(/^Question: (.*)$/m)?.[1] ?? "";
  const computed = t.match(/^Computed result \(from code; use exactly\): (.*)$/m)?.[1] ?? "";
  const draftRules = /^Draft data: YES/m.test(t);
  const lessonLine = t.match(/^- L\d+ "([^"]+)"(?: \[draft\])?: (.*?) Beyond the diamond: (.*?)(?: For a \w+: (.*))?$/m);
  const tryLines = [...t.matchAll(/ Try: ([^\n]+)/g)].map((m) => m[1]?.trim() ?? "").filter(Boolean);
  const drillLines = [...t.matchAll(/^- (.+?) \((individual|team|home)\): (.*)$/gm)].map((m) => `${m[1]}: ${m[3]}`);
  const focus = t.match(/^Focus \(one next step\): (.*)$/m)?.[1];
  const memory = t.match(/^- (mem-\d+): (.*)$/m);
  const hasDraftNotes = /\[draft/.test(t);
  const judgment = JUDGMENT_WORDS.test(question);
  const callType = t.match(/^Call type: (\w+)/m)?.[1] ?? "";

  const eligible = computed.match(/Earliest eligible date: ([^.]+, \d{4})\./)?.[1];
  const notEligible = /NOT eligible on the game date \(([^)]+)\)/.exec(computed)?.[1];
  const rest = computed.match(/(\d+) day\(s\) of rest/g)?.pop();
  const parts: string[] = [];
  if (eligible) {
    parts.push(notEligible ? `Not on ${notEligible}: the pitcher is not eligible yet.` : "Yes, the pitcher is eligible on the game date.");
    parts.push(`With ${rest ?? "the required rest"}, the earliest eligible date is ${eligible}.`);
    if (/House rule makes it/.test(computed)) parts.push("The event's house rule is stricter than the league chart, so it governs at this event.");
  } else if (/^Situations \(strategy\):\n- /m.test(t)) {
    const sit = t.match(/^Situations \(strategy\):\n- (.+?)(?: \[draft\])?\. Offense: (.+?) Defense: (.+?)(?: Common mistakes: .*?)? \(Applies only/m);
    // Lead with the first two sentences of the situation; the card below holds the rest.
    const lead = (sit?.[2] ?? "").match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(" ").trim();
    if (sit) parts.push(`${sit[1]}. ${lead ?? ""} The situation card below has what the offense and defense should do, and what to watch for. Check how your league's rulebook applies this (see the rule sources).`.replace(/\s+/g, " "));
  } else if (/protest/i.test(question) && judgment) {
    parts.push("A strike call is the umpire's judgment, and judgment calls can't be protested: a protest is only for how a written rule was applied. Tell the coach that calmly and once, then get the game moving. If the coach believes a rule was misapplied, the league's protest procedure (in the sources) is the place for it, after the game.");
  } else if (callType === "coaching") {
    const step = focus ? `The one next step: ${focus.toLowerCase()}.` : "Pick one small thing and practise it this week.";
    parts.push(role === "player"
      ? `That's a great thing to work on, and wanting to get better is where it starts. ${step} Progress comes from good reps, not from trying harder all at once.`
      : `Helping a player through this is worth the time. ${step} Small wins at practice rebuild confidence faster than talks about it, so set up reps the player can succeed at.`);
  } else if (judgment) {
    parts.push("That moment stings, and it's worth talking about. Whether those pitches were strikes was the umpire's call; what the player controls is readiness, where he stands, and his approach.");
  } else {
    parts.push(`That's a moment worth learning from. ${focus ? `The one next step: ${focus.toLowerCase()}.` : ""}`.trim());
  }
  if (draftRules && eligible) parts.push("This is based on draft rule data that hasn't been verified yet.");
  if (hasDraftNotes) parts.push("This guidance comes from draft coaching notes that haven't been reviewed yet.");

  const channel = role === "parent"
    ? { who: "You first, then the coach", how: "Let your child talk first on the ride home and keep it supportive; ask the coach for a few minutes later in the week if you want to talk technique." }
    : role === "umpire"
      ? { who: "Your partner or umpire-in-chief", how: "Talk it through after the game, calmly; between innings, keep your focus on the next play." }
      : role === "player"
        ? { who: "Your coach", how: "Ask at the start or end of practice for one thing to work on, then practise it with a parent or teammate between practices." }
        : callType === "coaching" || !RULE_WORDS.test(question)
          ? { who: "The player, one-on-one", how: "A short, calm talk at practice: one thing to work on, plenty of encouragement, and let the player tell you how it feels." }
          : { who: "Your players, then the tournament director if a rule is unclear", how: "Talk to the team at the next practice; take any rule question to the director calmly between innings, never a judgment call." };

  return json({
    what_happened: parts.join(" "),
    channel,
    teachable_moment: lessonLine ? `${lessonLine[1]}: ${lessonLine[2]}` : "Every game is a chance to learn something for the next one.",
    improvement_plan: role === "umpire"
      ? {
          individual: lessonLine?.[4] ? [lessonLine[4]] : ["Talk the play through with your partner after the game."],
          team: ["Before the next game, walk through dead-ball mechanics with your partner: who calls it, the signal, and where you meet."],
          at_home: [],
        }
      : {
          individual: tryLines.slice(0, 2).length ? tryLines.slice(0, 2) : ["Pick one small thing to practise this week."],
          team: drillLines.slice(0, 1),
          at_home: lessonLine?.[4] ? [lessonLine[4]] : [],
        },
    life_lesson: lessonLine ? `${lessonLine[3]}` : "",
    memory_used: memory?.[1] ? [memory[1]] : [],
  });
}

// ---------- CriticAgent ----------
const BLAME = /\b(your fault|her fault|his fault|cost (you|us|them) the game|bad call|umpire was wrong|umpire missed|blame (him|her|the umpire))\b/i;
function critic(messages: Msg[]): SampleReply {
  const draft = userText(messages).split("Draft:").pop() ?? "";
  const issues = BLAME.test(draft) ? ["Remove the blame: talk about the team and what the player controls, and treat the umpire's call as part of the game."] : [];
  return json({ pass: issues.length === 0, issues });
}

// ---------- MemoryAgent mining ----------
function mining(messages: Msg[]): SampleReply {
  const t = userText(messages);
  const m = t.match(/\((\w+), (\w+), age (\d+)\) (.*)/);
  if (!m) return { content: "[]", toolCalls: [] };
  const q = (m[4] ?? "").replace(/\s+/g, " ").trim();
  const fact = /scared|struck out|strikeout|error|confidence|pitches/i.test(q) ? [`A ${m[1]} of a ${m[3]}-year-old ${m[2]} player asked: ${q.slice(0, 160)}`] : [];
  return { content: JSON.stringify(fact), toolCalls: [] };
}

// ---------- ScorebookAgent (text only) ----------
const num = (s: string | undefined) => Number(s ?? 0);
function scorebook(messages: Msg[]): SampleReply {
  if (hasImage(messages)) throw new Error("400 this box cannot serve vision: SAMPLE_MODE has no model to read images");
  const t = userText(messages);
  const lines = t.split("\n").map((l) => l.trim());
  const header = t.match(/([A-Z][\w .'-]+?) (\d+), ([A-Z][\w .'-]+?) (\d+)/);
  const date = t.match(/(\w{3})\s+(\d{1,2}),\s+(\d{4})/);
  const months: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const iso = date && months[date[1] ?? ""] ? `${date[3]}-${months[date[1] ?? ""]}-${String(date[2]).padStart(2, "0")}` : null;
  const event = t.match(/\d{4}\s*-\s*(.+)$/m)?.[1]?.trim() ?? null;
  const section = (name: RegExp) => {
    const i = lines.findIndex((l) => name.test(l));
    if (i < 0) return [];
    const out: string[] = [];
    for (const l of lines.slice(i + 1)) { if (!l) break; out.push(l); }
    return out;
  };
  const ls = section(/^LINE SCORE/i).map((l) => l.split(/\s+/));
  const inningsCount = (ls[0]?.length ?? 4) - 4;
  const lineRow = (r: string[] | undefined) => ({ innings: (r ?? []).slice(1, 1 + inningsCount).map(Number), r: num(r?.at(-3)), h: num(r?.at(-2)), e: num(r?.at(-1)) });
  const away = lineRow(ls[0]); const home = lineRow(ls[1]);
  const statsTeam = (lines.find((l) => /BATTING/i.test(l)) ?? "").replace(/\s*BATTING.*$/i, "").trim();
  const playerRows = (rows: string[]) => rows.map((l) => { const m = l.match(/^(.+?#\d+|Totals)\s+(.*)$/); return m ? { name: m[1] ?? "", nums: (m[2] ?? "").split(/\s+/) } : null; }).filter((x): x is { name: string; nums: string[] } => x !== null);
  const bat = playerRows(section(/BATTING/i));
  const pit = playerRows(section(/PITCHING/i));
  const toBat = (n: string[]) => ({ ab: num(n[0]), r: num(n[1]), h: num(n[2]), rbi: num(n[3]), bb: num(n[4]), so: num(n[5]) });
  const toPit = (n: string[]) => ({ ip: n[0] ?? "0.0", h: num(n[1]), r: num(n[2]), er: num(n[3]), bb: num(n[4]), so: num(n[5]), pitches: n[6] === undefined ? null : num(n[6]) });
  const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const awayName = header?.[1] ?? "Away"; const homeName = header?.[3] ?? "Home";
  return json({
    away_team: awayName,
    home_team: homeName,
    date: iso,
    event,
    line_score: { away: away.innings, home: home.innings, away_rhe: { r: away.r, h: away.h, e: away.e }, home_rhe: { r: home.r, h: home.h, e: home.e } },
    stats_team: statsTeam ? titleCase(statsTeam) : homeName,
    batting: bat.filter((b) => b.name !== "Totals").map((b) => ({ player: b.name, ...toBat(b.nums) })),
    batting_totals: bat.find((b) => b.name === "Totals") ? toBat(bat.find((b) => b.name === "Totals")!.nums) : null,
    pitching: pit.filter((p) => p.name !== "Totals").map((p) => ({ player: p.name, ...toPit(p.nums) })),
    pitching_totals: pit.find((p) => p.name === "Totals") ? toPit(pit.find((p) => p.name === "Totals")!.nums) : null,
  });
}

// ---------- GameReviewAgent ----------
function gameReview(messages: Msg[]): SampleReply {
  const t = userText(messages);
  const result = t.match(/result: (win|loss|tie)/)?.[1] ?? "loss";
  const kRate = Number(t.match(/strikeouts (\d+) \((\d+)% of plate appearances\)/)?.[2] ?? 0);
  const ks = Number(t.match(/strikeouts (\d+) \(/)?.[1] ?? 0);
  const pa = Number(t.match(/Plate appearances (\d+)/)?.[1] ?? 0);
  const errors = Number(t.match(/Errors committed (\d+)/)?.[1] ?? 0);
  const walksAllowed = Number(t.match(/Walks allowed (\d+)/)?.[1] ?? 0);
  const big = (t.match(/big innings \(2\+ runs\): ([^\n]+)/)?.[1] ?? "none").replace(/\.$/, "");
  const finals = t.match(/^Game: .+? (\d+), .+? (\d+)[ .]/m);
  const margin = finals ? Math.abs(Number(finals[1]) - Number(finals[2])) : 0;
  const called = t.match(/called third strikes (\d+) of (\d+) strikeouts/);
  const calledKs = Number(called?.[1] ?? 0);
  const lessons = menu(t, "Lessons:", "L\\d+");
  const insights = menu(t, "Coaching insights:", "C\\d+");
  const drills = menu(t, "Drills:", "[0-9a-f-]{8,}");
  const find = (items: MenuItem[], re: RegExp) => items.find((i) => re.test(i.text))?.id;
  const priorities: { title: string; why: string; drill_ids: string[]; insight_ids: string[] }[] = [];
  if (kRate >= 25 || calledKs >= 3) priorities.push({ title: "Two-strike approach", why: calledKs >= 3 ? `${calledKs} of our ${ks} strikeouts were called third strikes: protect the zone with two strikes.` : `We struck out in ${ks} of ${pa} plate appearances (${kRate}%).`, drill_ids: [find(drills, /two_strike/)].filter(Boolean) as string[], insight_ids: [find(insights, /two_strike_approach/), find(insights, /plate_coverage/)].filter(Boolean) as string[] });
  if (errors >= 2) priorities.push({ title: "Clean up routine plays", why: `We made ${errors} errors.`, drill_ids: [find(drills, /catching|fielding|ground/)].filter(Boolean) as string[], insight_ids: [] });
  if (walksAllowed >= 4) priorities.push({ title: "Throw strikes early in the count", why: `Our pitchers walked ${walksAllowed}.`, drill_ids: [], insight_ids: [find(insights, /pitch_workload/)].filter(Boolean) as string[] });
  if (priorities.length === 0) priorities.push({ title: "Quality at-bats", why: `We reached base and competed in ${pa} plate appearances; keep building on it.`, drill_ids: [], insight_ids: [] });
  const lesson = (result === "win" ? find(lessons, /Win as a team/) : find(lessons, /built on failure/) ?? find(lessons, /Win as a team/)) ?? lessons[0]?.id ?? "L001";
  return json({
    headline: result === "win" ? "A team win, with something to build on." : margin <= 2 ? "A close game and a clear next step for practice." : "A tough one, and a clear next step for practice.",
    what_decided_it: [big !== "none" ? `The other team's big inning (${big}).` : "A tight game decided by a few plays.", ...(kRate >= 25 ? [`${ks} strikeouts in ${pa} plate appearances.`] : [])].slice(0, 3),
    strengths: [walksAllowed <= 3 ? `Our pitchers walked only ${walksAllowed}.` : "We kept competing to the last out."],
    priorities: priorities.slice(0, 3),
    lesson_id: lesson,
    team_talk: result === "win" ? "We won that one as a team. Enjoy it, then let's get better at practice." : "We lost that one as a team, and we'll get better as a team. Nobody here is defined by one game.",
    at_home: ["Ten dry swings with a two-strike, choked-up grip."],
    memory_used: [],
  });
}

/** Answer one model call offline. Agent names come from GeneratorOpts.agent. */
export function sampleReply(messages: Msg[], agent: string | undefined): SampleReply {
  const system = systemText(messages);
  switch (agent) {
    case "contextAgent": return context(messages);
    case "rulesAgent": return rules(messages);
    case "developmentAgent": return development(messages);
    case "callTypeAgent": return callType(messages);
    case "coachingAgent": return coaching(messages);
    case "criticAgent": return critic(messages);
    case "memoryAgent": return mining(messages);
    case "scorebookAgent": return scorebook(messages);
    case "gameReviewAgent": return gameReview(messages);
    default:
      return { content: /JSON/.test(system) ? "{}" : "ready", toolCalls: [] };
  }
}
