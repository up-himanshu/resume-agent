import type OpenAI from "openai";
import { z } from "zod";

// Local tools run inside the agent process, next to the MCP tools. This one is a calculator:
// LLMs are unreliable at date arithmetic (in testing, gpt-5-mini said "10 years 2 months" for a
// span that is 10 years 4 months), so the model reads the dates and the code does the maths.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DateArg = z.union([z.string().regex(MONTH_RE, 'Use "YYYY-MM"'), z.literal("present")]);

const MonthsBetweenArgs = z.object({
  ranges: z
    .array(z.object({ label: z.string(), start: z.string().regex(MONTH_RE, 'Use "YYYY-MM"'), end: DateArg }))
    .min(1)
    .max(30),
});

const toIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const nowIndex = () => {
  const d = new Date();
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
const human = (months: number) => `${Math.floor(months / 12)} years ${months % 12} months`;

function monthsBetween(args: z.infer<typeof MonthsBetweenArgs>) {
  const covered = new Set<number>();
  const ranges = args.ranges.map((r) => {
    const start = toIndex(r.start);
    const end = r.end === "present" ? nowIndex() : toIndex(r.end);
    if (end < start) throw new Error(`"${r.label}": end ${r.end} is before start ${r.start}`);
    for (let m = start; m <= end; m++) covered.add(m);
    const months = end - start + 1;
    return { label: r.label, start: r.start, end: r.end, months, duration: human(months) };
  });
  return {
    convention: "Inclusive: both the start and end months count. 'present' means the current month.",
    ranges,
    // Union, so overlapping roles aren't double-counted.
    totalMonthsWithoutOverlap: covered.size,
    total: human(covered.size),
  };
}

export const LOCAL_TOOLS: Record<string, { definition: OpenAI.Chat.Completions.ChatCompletionTool; run: (args: unknown) => string }> = {
  months_between: {
    definition: {
      type: "function",
      function: {
        name: "months_between",
        description:
          "Exact calculator for durations between months. Use it for ANY duration or total-experience question instead of " +
          "computing dates yourself. Returns each range's length and the total without double-counting overlaps.",
        parameters: {
          type: "object",
          properties: {
            ranges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "e.g. the company name" },
                  start: { type: "string", description: 'Start month as "YYYY-MM"' },
                  end: { type: "string", description: 'End month as "YYYY-MM", or "present"' },
                },
                required: ["label", "start", "end"],
                additionalProperties: false,
              },
            },
          },
          required: ["ranges"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    // Plain sentences, not JSON: the model cites tool output with verbatim quotes, and a line like
    // "Total without overlap: 125 months (10 years 5 months)" is easy to quote exactly.
    run: (args) => {
      const r = monthsBetween(MonthsBetweenArgs.parse(args));
      return [
        ...r.ranges.map((x) => `${x.label}: ${x.start} to ${x.end} = ${x.months} months (${x.duration})`),
        `Total without overlap: ${r.totalMonthsWithoutOverlap} months (${r.total})`,
        `Convention: ${r.convention}`,
      ].join("\n");
    },
  },
};
