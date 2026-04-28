import { NextResponse } from "next/server";
import { getDb, initSchema } from "@/lib/db";
import { fetchAgentMetrics } from "@/lib/buildkite-metrics";

let schemaInitialized = false;

export async function GET() {
  const token = process.env.BUILDKITE_AGENT_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "BUILDKITE_AGENT_TOKEN not configured" },
      { status: 500 },
    );
  }

  try {
    const db = getDb();

    if (!schemaInitialized) {
      await initSchema();
      schemaInitialized = true;
    }

    const metrics = await fetchAgentMetrics(token);
    const now = new Date();

    const agentQueues = metrics.agents.queues ?? {};
    const jobQueues = metrics.jobs.queues ?? {};
    const allQueues = new Set([
      ...Object.keys(agentQueues),
      ...Object.keys(jobQueues),
    ]);

    let stored = 0;
    for (const queue of allQueues) {
      const agents = agentQueues[queue] ?? { idle: 0, busy: 0, total: 0 };
      const jobs = jobQueues[queue] ?? {
        scheduled: 0,
        running: 0,
        waiting: 0,
        total: 0,
      };
      const waiting = jobs.waiting;

      await db`
        INSERT INTO queue_snapshots (
          polled_at, queue,
          agents_idle, agents_busy, agents_total,
          jobs_scheduled, jobs_running, jobs_waiting, jobs_total
        ) VALUES (
          ${now}, ${queue},
          ${agents.idle}, ${agents.busy}, ${agents.total},
          ${jobs.scheduled}, ${jobs.running}, ${waiting}, ${jobs.total}
        )
      `;
      stored++;
    }

    return NextResponse.json({
      ok: true,
      queues: stored,
      polled_at: now.toISOString(),
    });
  } catch (error) {
    console.error("Poll agents failed:", error);
    return NextResponse.json(
      { error: "Failed to poll agents" },
      { status: 500 },
    );
  }
}
