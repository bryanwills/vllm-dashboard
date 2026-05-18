import { NextRequest, NextResponse } from "next/server";
import { queryDatabricks } from "@/lib/databricks";
import { loadEvalRows, type EvalRow } from "@/lib/eval-data";
import {
  buildSummary,
  compareEvalRows,
  comparePerfRows,
  loadPerfRowsByImages,
  sortDeltas,
  type CompareSummary,
  type DeltaItem,
  type CoverageItem,
  type PerfRun,
} from "@/lib/compare";
import { postMessage } from "@/lib/slack";

export const maxDuration = 55;

interface NightlyRow {
  commit: string;
  image: string;
  latest_ts: string;
}

interface ModelGroup {
  model: string;
  config: string;
  perfDeltas: DeltaItem[];
  evalDeltas: DeltaItem[];
  perfMissing: CoverageItem[];
  evalMissing: CoverageItem[];
}

async function loadNightlyCommits(limit: number): Promise<NightlyRow[]> {
  return queryDatabricks<NightlyRow>(`
    WITH nights AS (
      SELECT
        NULLIF(
          COALESCE(
            NULLIF(message:vllm_commit::STRING, ''),
            regexp_extract(LOWER(message:image::STRING), 'nightly-([0-9a-f]+)', 1)
          ),
          ''
        ) AS commit,
        message:image::STRING AS image,
        COALESCE(message:date::DOUBLE, message:data:date::DOUBLE) AS ts
      FROM vllm_data_warehouse.default.vllm_eval_data_ingest
      WHERE message:nightly::BOOLEAN = TRUE
        AND message:image::STRING IS NOT NULL

      UNION ALL

      SELECT
        NULLIF(regexp_extract(LOWER(message:image::STRING), 'nightly-([0-9a-f]+)', 1), '') AS commit,
        message:image::STRING AS image,
        unix_timestamp(message:date::STRING) AS ts
      FROM vllm_data_warehouse.default.vllm_perf_data_ingest
      WHERE message:nightly::BOOLEAN = TRUE
        AND message:image::STRING IS NOT NULL
    )
    SELECT
      commit,
      MAX(image) AS image,
      CAST(MAX(ts) AS STRING) AS latest_ts
    FROM nights
    WHERE commit IS NOT NULL
    GROUP BY commit
    ORDER BY MAX(ts) DESC
    LIMIT ${limit}
  `);
}

function groupPerfByImage(rows: PerfRun[]): Map<string, PerfRun[]> {
  const out = new Map<string, PerfRun[]>();
  for (const r of rows) {
    const arr = out.get(r.image) ?? [];
    arr.push(r);
    out.set(r.image, arr);
  }
  return out;
}

function groupEvalByImage(rows: EvalRow[]): Map<string, EvalRow[]> {
  const out = new Map<string, EvalRow[]>();
  for (const r of rows) {
    if (!r.image) continue;
    const arr = out.get(r.image) ?? [];
    arr.push(r);
    out.set(r.image, arr);
  }
  return out;
}

function extractConfig(d: DeltaItem): string {
  const parts = d.dimension.split(" - ");
  return parts.length > 1 ? parts.join(" · ") : d.dimension;
}

function groupByModel(
  perfDeltas: DeltaItem[],
  evalDeltas: DeltaItem[],
  perfMissingCandidate: CoverageItem[],
  evalMissingCandidate: CoverageItem[],
): ModelGroup[] {
  const map = new Map<string, ModelGroup>();

  function getGroup(model: string, configSource: string): ModelGroup {
    let g = map.get(model);
    if (!g) {
      g = { model, config: configSource, perfDeltas: [], evalDeltas: [], perfMissing: [], evalMissing: [] };
      map.set(model, g);
    }
    return g;
  }

  for (const d of perfDeltas) {
    const g = getGroup(d.model, extractConfig(d));
    g.perfDeltas.push(d);
  }
  for (const d of evalDeltas) {
    const existing = map.get(d.model);
    const g = getGroup(d.model, existing?.config ?? extractConfig(d));
    g.evalDeltas.push(d);
  }
  for (const c of perfMissingCandidate) {
    const g = getGroup(c.model, c.dimension);
    g.perfMissing.push(c);
  }
  for (const c of evalMissingCandidate) {
    const existing = map.get(c.model);
    const g = getGroup(c.model, existing?.config ?? c.dimension);
    g.evalMissing.push(c);
  }

  return [...map.values()];
}

function countByStatus(deltas: DeltaItem[]): Record<string, number> {
  const counts: Record<string, number> = { regression: 0, improvement: 0, noisy: 0, unchanged: 0 };
  for (const d of deltas) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return counts;
}

function fmtPct(v: number | null): string {
  if (v === null) return "N/A";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function fmtEvalScore(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function formatModelSection(g: ModelGroup): string {
  const allDeltas = [...g.perfDeltas, ...g.evalDeltas];
  const totalMissing = g.perfMissing.length + g.evalMissing.length;

  if (allDeltas.length === 0 && totalMissing > 0) {
    return `*${g.model}* — ${totalMissing} metrics missing (not yet run for this nightly)`;
  }

  const lines: string[] = [];
  lines.push(`*${g.model}* · ${g.config}`);

  if (g.perfDeltas.length > 0) {
    const counts = countByStatus(g.perfDeltas);
    const statusParts: string[] = [];
    if (counts.regression > 0) statusParts.push(`${counts.regression} regression`);
    if (counts.improvement > 0) statusParts.push(`${counts.improvement} improvement`);
    if (counts.noisy > 0) statusParts.push(`${counts.noisy} noisy`);
    if (counts.unchanged > 0) statusParts.push(`${counts.unchanged} unchanged`);
    const perfSummaries = g.perfDeltas
      .filter(d => d.status === "regression" || d.status === "improvement")
      .map(d => `${d.metricLabel} ${fmtPct(d.deltaPct)}`)
      .join(", ");
    const detail = perfSummaries ? `: ${perfSummaries}` : "";
    lines.push(`  Perf (${statusParts.join(", ")})${detail}`);
  }

  if (g.evalDeltas.length > 0) {
    const counts = countByStatus(g.evalDeltas);
    const statusParts: string[] = [];
    if (counts.regression > 0) statusParts.push(`${counts.regression} regression`);
    if (counts.improvement > 0) statusParts.push(`${counts.improvement} improvement`);
    if (counts.noisy > 0) statusParts.push(`${counts.noisy} noisy`);
    if (counts.unchanged > 0) statusParts.push(`${counts.unchanged} unchanged`);
    const evalDetails = g.evalDeltas
      .map(d => {
        const sigStr = d.significance !== null ? ` (σ=${d.significance.toFixed(2)})` : "";
        return `\`${d.metricLabel}\` ${fmtEvalScore(d.baselineValue)} → ${fmtEvalScore(d.candidateValue)}${sigStr}`;
      })
      .join(", ");
    lines.push(`  Eval (${statusParts.join(", ")}): ${evalDetails}`);
  }

  if (totalMissing > 0) {
    lines.push(`  _${g.perfMissing.length} perf + ${g.evalMissing.length} eval metrics missing in candidate_`);
  }

  return lines.join("\n");
}

function formatNightlyMessage(
  commit: string,
  prevCommit: string,
  date: string,
  summary: CompareSummary,
  perfDeltas: DeltaItem[],
  evalDeltas: DeltaItem[],
  perfMissingCandidate: CoverageItem[],
  evalMissingCandidate: CoverageItem[],
): string {
  const dateStr = new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const lines: string[] = [];
  lines.push(`*Nightly Perf/Eval Summary — ${dateStr}*`);
  lines.push("");
  lines.push(`Commit: \`${commit.slice(0, 7)}\` vs previous nightly \`${prevCommit.slice(0, 7)}\``);
  lines.push(
    `Total: *${summary.matched} matched* (${summary.perfMatched} perf, ${summary.evalMatched} eval) — ` +
    `${summary.regressions} regressions, ${summary.improvements} improvements, ${summary.noisy} noisy, ${summary.unchanged} unchanged`
  );

  const groups = groupByModel(perfDeltas, evalDeltas, perfMissingCandidate, evalMissingCandidate);
  if (groups.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    for (const g of groups) {
      lines.push(formatModelSection(g));
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json(
      { error: "SLACK_BOT_TOKEN not configured" },
      { status: 500 },
    );
  }

  try {
    const channel = process.env.SLACK_CI_NOTIFICATIONS_CHANNEL;
    if (!channel) {
      return NextResponse.json(
        { error: "SLACK_CI_NOTIFICATIONS_CHANNEL must be set" },
        { status: 500 },
      );
    }
    const perfThreshold = 0.02;
    const evalSigma = 2;

    const nightlies = await loadNightlyCommits(2);
    if (nightlies.length < 2) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Need at least 2 nightlies to compare" });
    }

    const current = nightlies[0];
    const prev = nightlies[1];

    const [perfRows, evalRows] = await Promise.all([
      loadPerfRowsByImages([current.image, prev.image]),
      loadEvalRows({ images: [current.image, prev.image] }),
    ]);

    const perfByImage = groupPerfByImage(perfRows);
    const evalByImage = groupEvalByImage(evalRows);

    const candidatePerf = perfByImage.get(current.image) ?? [];
    const baselinePerf = perfByImage.get(prev.image) ?? [];
    const candidateEval = evalByImage.get(current.image) ?? [];
    const baselineEval = evalByImage.get(prev.image) ?? [];

    const perfResult = comparePerfRows(
      [...baselinePerf, ...candidatePerf],
      prev.image,
      current.image,
      perfThreshold,
    );
    const evalResult = compareEvalRows(
      [...baselineEval, ...candidateEval],
      prev.image,
      current.image,
      evalSigma,
    );

    const summary = buildSummary(perfResult, evalResult);
    const perfDeltas = perfResult.deltas.sort(sortDeltas);
    const evalDeltas = evalResult.deltas.sort(sortDeltas);

    const tsEpoch = parseFloat(current.latest_ts);
    const date = Number.isFinite(tsEpoch) && tsEpoch > 0
      ? new Date(tsEpoch * 1000).toISOString()
      : new Date().toISOString();

    const text = formatNightlyMessage(
      current.commit,
      prev.commit,
      date,
      summary,
      perfDeltas,
      evalDeltas,
      perfResult.missingCandidate,
      evalResult.missingCandidate,
    );

    const result = await postMessage(text, undefined, channel);
    if (!result.ok) {
      return NextResponse.json({ error: `Slack post failed: ${result.error}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      commit: current.commit.slice(0, 7),
      prevCommit: prev.commit.slice(0, 7),
      matched: summary.matched,
      regressions: summary.regressions,
      improvements: summary.improvements,
      noisy: summary.noisy,
      messageTs: result.ts,
    });
  } catch (error) {
    console.error("Nightly summary cron failed:", error);
    return NextResponse.json(
      { error: "Failed to send nightly summary" },
      { status: 500 },
    );
  }
}
