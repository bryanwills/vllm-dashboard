import { NextRequest, NextResponse } from "next/server";
import { queryDatabricks } from "@/lib/databricks";

export interface EvalSample {
  doc_id: number;
  task: string;
  filter: string;
  exact_match: number;
  question: string;
  prompt: string;
  target: string;
  response: string;
  filtered_response: string;
  metrics: string[];
}

interface RawRow {
  m: string;
}

interface SampleEntry {
  doc_id?: number;
  doc?: { question?: string; answer?: string };
  arguments?: Record<string, { arg_0?: string }>;
  target?: string;
  resps?: string[][];
  filtered_resps?: string[];
  exact_match?: number;
  filter?: string;
  metrics?: string[];
}

interface SampleMessage {
  kind?: string;
  task?: string;
  workload?: string;
  // singular `sample` (old per-row ingest) OR plural `samples` (new batched ingest)
  sample?: SampleEntry;
  samples?: SampleEntry[];
}

function flattenSampleRow(raw: SampleMessage): { task: string; entries: SampleEntry[] } {
  const task = raw.task ?? "";
  if (Array.isArray(raw.samples)) return { task, entries: raw.samples };
  if (raw.sample) return { task, entries: [raw.sample] };
  return { task, entries: [] };
}

function toSample(task: string, s: SampleEntry): EvalSample {
  let prompt = "";
  if (s.arguments) {
    for (const v of Object.values(s.arguments)) {
      if (v?.arg_0) {
        prompt = String(v.arg_0);
        break;
      }
    }
  }
  return {
    doc_id: s.doc_id ?? -1,
    task,
    filter: s.filter ?? "",
    exact_match: typeof s.exact_match === "number" ? s.exact_match : Number(s.exact_match ?? 0),
    question: s.doc?.question ?? "",
    prompt,
    target: s.target ?? s.doc?.answer ?? "",
    response: s.resps?.[0]?.[0] ?? "",
    filtered_response: s.filtered_resps?.[0] ?? "",
    metrics: Array.isArray(s.metrics) ? s.metrics : [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const buildId = sp.get("build_id");
    const taskParam = sp.get("task");
    const correct = sp.get("correct"); // "true" | "false" | null (all)
    const limitParam = parseInt(sp.get("limit") ?? "200", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 5000) : 200;

    if (!buildId) {
      return NextResponse.json({ error: "Missing build_id" }, { status: 400 });
    }

    const escBuild = buildId.replace(/'/g, "''");
    const escTask = taskParam ? taskParam.replace(/'/g, "''") : null;

    // Pull every row that holds samples for this build. Note: rows with
    // batched samples have task name on the row, but verify per-entry below
    // since the older ingest occasionally mis-tagged the top-level task.
    const conds = [
      "CAST(message:kind AS STRING) IN ('sample', 'samples')",
      `CAST(message:buildkite_build_id AS STRING) = '${escBuild}'`,
    ];
    // We can't reliably filter samples-plural rows by task in SQL because each
    // row may contain entries from a single file (one task). The top-level
    // task field is set per-file, so it's safe to filter on it.
    if (escTask) conds.push(`CAST(message:task AS STRING) = '${escTask}'`);

    const rawRows = await queryDatabricks<RawRow>(`
      SELECT CAST(message AS STRING) AS m
      FROM vllm_data_warehouse.default.vllm_eval_data_ingest
      WHERE ${conds.join(" AND ")}
    `);

    // Flatten and apply correctness filter in JS.
    const allSamples: EvalSample[] = [];
    for (const r of rawRows) {
      let raw: SampleMessage;
      try {
        raw = JSON.parse(r.m);
      } catch {
        continue;
      }
      const { task, entries } = flattenSampleRow(raw);
      for (const entry of entries) {
        const sample = toSample(task, entry);
        if (correct === "true" && sample.exact_match < 1) continue;
        if (correct === "false" && sample.exact_match >= 1) continue;
        allSamples.push(sample);
      }
    }

    // Stable sort by doc_id, then by filter (so strict-match and flexible-extract
    // for the same doc are adjacent).
    allSamples.sort((a, b) => {
      if (a.doc_id !== b.doc_id) return a.doc_id - b.doc_id;
      return a.filter.localeCompare(b.filter);
    });

    // Build counts from the FULL set (ignoring the correct filter) so the
    // drawer's filter pills always show totals.
    let correctCount = 0;
    let incorrectCount = 0;
    for (const r of rawRows) {
      let raw: SampleMessage;
      try {
        raw = JSON.parse(r.m);
      } catch {
        continue;
      }
      const { entries } = flattenSampleRow(raw);
      for (const entry of entries) {
        const em = typeof entry.exact_match === "number"
          ? entry.exact_match
          : Number(entry.exact_match ?? 0);
        if (em >= 1) correctCount++;
        else incorrectCount++;
      }
    }

    const truncated = allSamples.length > limit;
    const samples = truncated ? allSamples.slice(0, limit) : allSamples;

    return NextResponse.json({
      samples,
      total: correctCount + incorrectCount,
      correct: correctCount,
      incorrect: incorrectCount,
      truncated,
    });
  } catch (error) {
    console.error("Failed to fetch eval samples:", error);
    return NextResponse.json(
      { error: "Failed to fetch evaluation samples" },
      { status: 500 }
    );
  }
}
