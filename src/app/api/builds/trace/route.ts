import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const MAX_SPANS = 5_000;
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

type TraceRow = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  span_name: string;
  start_time: Date;
  end_time: Date;
  duration_ms: number;
  status_code: number;
  step_key: string | null;
  job_id: string | null;
  job_label: string | null;
  job_state: string | null;
  agent_queue: string | null;
  step_label: string | null;
  group_label: string | null;
  step_outcome: string | null;
  job_passed: string | null;
  job_url: string | null;
  step_url: string | null;
  wait_ms: number | null;
  ci_kind: string | null;
  command_index: number | null;
  command_label: string | null;
  test_nodeid: string | null;
  test_outcome: string | null;
  received_at: Date;
};

type LaneKind = "job" | "step" | "command" | "test";

type Lane = {
  id: string;
  parentId: string | null;
  traceId: string;
  kind: LaneKind;
  label: string;
  group: string | null;
  stepKey: string | null;
  jobId: string | null;
  queue: string | null;
  startTime: string;
  endTime: string;
  durationMs: number;
  waitMs: number;
  status: "passed" | "failed" | "skipped" | "unknown";
  outcome: string | null;
  url: string | null;
  critical: boolean;
};

function laneStatus(row: TraceRow): Lane["status"] {
  if (row.test_outcome === "skipped") return "skipped";
  if (
    row.status_code === 2 ||
    row.job_passed === "false" ||
    row.step_outcome === "failed" ||
    row.test_outcome === "failed"
  ) {
    return "failed";
  }
  if (
    row.status_code === 1 ||
    row.job_passed === "true" ||
    row.step_outcome === "passed" ||
    row.test_outcome === "passed"
  ) {
    return "passed";
  }
  return "unknown";
}

function markCompletionFrontier(lanes: Lane[]) {
  const ordered = [...lanes].sort((a, b) => {
    const start = Date.parse(a.startTime) - Date.parse(b.startTime);
    if (start !== 0) return start;
    return Date.parse(b.endTime) - Date.parse(a.endTime);
  });
  let furthestEnd = Number.NEGATIVE_INFINITY;
  const frontier = new Set<string>();
  for (const lane of ordered) {
    const end = Date.parse(lane.endTime);
    if (end > furthestEnd + 1) {
      frontier.add(lane.id);
      furthestEnd = end;
    }
  }
  return lanes.map((lane) => ({
    ...lane,
    critical: frontier.has(lane.id),
  }));
}

function error(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function jobLane(row: TraceRow, id = row.span_id): Lane {
  return {
    id,
    parentId: row.parent_span_id,
    traceId: row.trace_id,
    kind: row.span_name === "buildkite.step" ? "step" : "job",
    label: row.job_label ?? row.step_label ?? row.span_name,
    group: row.group_label,
    stepKey: row.step_key,
    jobId: row.job_id,
    queue: row.agent_queue,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    durationMs: Number(row.duration_ms),
    waitMs: Math.max(0, Number(row.wait_ms ?? 0)),
    status: laneStatus(row),
    outcome: row.job_state ?? row.step_outcome,
    url: row.job_url ?? row.step_url,
    critical: false,
  };
}

function detailKind(row: TraceRow): "command" | "test" | null {
  if (row.ci_kind === "command") return "command";
  if (row.ci_kind === "test") return "test";
  return null;
}

function detailLabel(row: TraceRow, kind: "command" | "test"): string {
  if (kind === "test") return row.test_nodeid ?? row.span_name;
  const prefix = row.command_index ? `${row.command_index}. ` : "";
  return `${prefix}${row.command_label ?? row.span_name}`;
}

export async function GET(request: NextRequest) {
  const organization = request.nextUrl.searchParams.get("organization") ?? "";
  const pipeline = request.nextUrl.searchParams.get("pipeline") ?? "";
  const buildNumber = request.nextUrl.searchParams.get("buildNumber") ?? "";

  if (!SLUG.test(organization) || !SLUG.test(pipeline)) {
    return error("Invalid Buildkite organization or pipeline", 400);
  }
  if (!/^\d{1,12}$/.test(buildNumber)) {
    return error("Invalid Buildkite build number", 400);
  }

  try {
    const db = getDb();
    const rows = await db<TraceRow[]>`
      SELECT
        trace_id,
        span_id,
        parent_span_id,
        span_name,
        start_time,
        end_time,
        duration_ms,
        status_code,
        step_key,
        job_id,
        job_label,
        job_state,
        agent_queue,
        NULLIF(span_attributes->>'buildkite.step.label', '') AS step_label,
        NULLIF(span_attributes->>'buildkite.step.group.label', '') AS group_label,
        NULLIF(span_attributes->>'buildkite.step.outcome', '') AS step_outcome,
        NULLIF(span_attributes->>'buildkite.job.passed', '') AS job_passed,
        NULLIF(span_attributes->>'buildkite.job.web_url', '') AS job_url,
        NULLIF(span_attributes->>'buildkite.step.web_url', '') AS step_url,
        CASE
          WHEN span_attributes->>'buildkite.job.wait_time_ms' ~ '^\d+(\.\d+)?$'
          THEN (span_attributes->>'buildkite.job.wait_time_ms')::double precision
          ELSE 0
        END AS wait_ms,
        NULLIF(span_attributes->>'ci.span.kind', '') AS ci_kind,
        CASE
          WHEN span_attributes->>'ci.command.index' ~ '^\d+$'
          THEN (span_attributes->>'ci.command.index')::integer
          ELSE NULL
        END AS command_index,
        NULLIF(span_attributes->>'ci.command.label', '') AS command_label,
        NULLIF(span_attributes->>'test.nodeid', '') AS test_nodeid,
        NULLIF(span_attributes->>'test.outcome', '') AS test_outcome,
        received_at
      FROM otel_spans
      WHERE organization_slug = ${organization}
        AND pipeline_slug = ${pipeline}
        AND build_number = ${buildNumber}::bigint
      ORDER BY start_time ASC, duration_ms DESC
      LIMIT ${MAX_SPANS}
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        {
          available: false,
          complete: false,
          truncated: false,
          lanes: [],
          summary: null,
        },
        { headers: { "Cache-Control": "private, max-age=5" } },
      );
    }

    const childJobParents = new Set(
      rows
        .filter((row) => row.span_name === "buildkite.job")
        .map((row) => row.parent_span_id)
        .filter((value): value is string => Boolean(value)),
    );
    const controlRows = rows.filter(
      (row) =>
        row.span_name === "buildkite.job" ||
        (row.span_name === "buildkite.step" &&
          !childJobParents.has(row.span_id)),
    );
    const details = rows.filter((row) => detailKind(row) !== null);

    const baseJobLanes = controlRows.map((row) => jobLane(row));
    const jobLaneByJobId = new Map(
      baseJobLanes
        .filter((lane) => lane.jobId)
        .map((lane) => [lane.jobId as string, lane]),
    );

    const detailRowsByJobId = new Map<string, TraceRow[]>();
    for (const row of details) {
      if (!row.job_id) continue;
      const jobRows = detailRowsByJobId.get(row.job_id) ?? [];
      jobRows.push(row);
      detailRowsByJobId.set(row.job_id, jobRows);
    }
    for (const [jobId, jobRows] of detailRowsByJobId) {
      if (jobLaneByJobId.has(jobId)) continue;
      const first = jobRows[0];
      const start = Math.min(...jobRows.map((row) => row.start_time.getTime()));
      const end = Math.max(...jobRows.map((row) => row.end_time.getTime()));
      const synthetic = jobLane(first, `job:${jobId}`);
      synthetic.parentId = null;
      synthetic.startTime = new Date(start).toISOString();
      synthetic.endTime = new Date(end).toISOString();
      synthetic.durationMs = Math.max(0, end - start);
      synthetic.waitMs = 0;
      synthetic.status = jobRows.some((row) => laneStatus(row) === "failed")
        ? "failed"
        : "unknown";
      baseJobLanes.push(synthetic);
      jobLaneByJobId.set(jobId, synthetic);
    }

    const jobLanes = markCompletionFrontier(baseJobLanes);
    const commandIds = new Set(
      details
        .filter((row) => detailKind(row) === "command")
        .map((row) => row.span_id),
    );
    const detailLanes = details.map((row): Lane => {
      const kind = detailKind(row) as "command" | "test";
      const jobParent = row.job_id
        ? (jobLaneByJobId.get(row.job_id)?.id ?? null)
        : null;
      const parentId =
        kind === "test" &&
        row.parent_span_id &&
        commandIds.has(row.parent_span_id)
          ? row.parent_span_id
          : jobParent;
      return {
        id: row.span_id,
        parentId,
        traceId: row.trace_id,
        kind,
        label: detailLabel(row, kind),
        group: row.group_label,
        stepKey: row.step_key,
        jobId: row.job_id,
        queue: row.agent_queue,
        startTime: row.start_time.toISOString(),
        endTime: row.end_time.toISOString(),
        durationMs: Number(row.duration_ms),
        waitMs: 0,
        status: laneStatus(row),
        outcome: kind === "test" ? row.test_outcome : null,
        url: null,
        critical: false,
      };
    });
    const lanes = [...jobLanes, ...detailLanes];

    const buildSpan = rows.find((row) => row.span_name === "buildkite.build");
    const laneStarts = jobLanes.map(
      (lane) => Date.parse(lane.startTime) - lane.waitMs,
    );
    const laneEnds = jobLanes.map((lane) => Date.parse(lane.endTime));
    const observedStart = buildSpan
      ? buildSpan.start_time.getTime()
      : laneStarts.length > 0
        ? Math.min(...laneStarts)
        : Math.min(...rows.map((row) => row.start_time.getTime()));
    const observedEnd = buildSpan
      ? buildSpan.end_time.getTime()
      : laneEnds.length > 0
        ? Math.max(...laneEnds)
        : Math.max(...rows.map((row) => row.end_time.getTime()));
    const latestReceived = Math.max(
      ...rows.map((row) => row.received_at.getTime()),
    );
    const commandCount = detailLanes.filter(
      (lane) => lane.kind === "command",
    ).length;
    const testCount = detailLanes.filter((lane) => lane.kind === "test").length;

    return NextResponse.json(
      {
        available: true,
        complete: Boolean(buildSpan),
        truncated: rows.length === MAX_SPANS,
        lanes,
        summary: {
          observedStart: new Date(observedStart).toISOString(),
          observedEnd: new Date(observedEnd).toISOString(),
          observedDurationMs: Math.max(0, observedEnd - observedStart),
          spanCount: rows.length,
          laneCount: jobLanes.length,
          commandCount,
          testCount,
          traceCount: new Set(rows.map((row) => row.trace_id)).size,
          queueCount: new Set(
            jobLanes.map((lane) => lane.queue).filter(Boolean),
          ).size,
          criticalCount: jobLanes.filter((lane) => lane.critical).length,
          latestReceivedAt: new Date(latestReceived).toISOString(),
        },
      },
      { headers: { "Cache-Control": "private, max-age=5" } },
    );
  } catch (cause) {
    console.error("Failed to load build trace:", cause);
    return error("Failed to load build trace", 500);
  }
}
