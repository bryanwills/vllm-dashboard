import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const searchParams = request.nextUrl.searchParams;
    const hours = Math.min(
      parseInt(searchParams.get("hours") ?? "24", 10) || 24,
      720,
    );
    const queue = searchParams.get("queue") || null;
    const cutoff = new Date(Date.now() - hours * 3600 * 1000);

    // For short windows, return raw snapshots (5-min resolution is fine).
    // For longer windows, aggregate to reduce data volume.
    let snapshots;
    if (hours <= 6) {
      // Raw 5-min snapshots
      snapshots = queue
        ? await db`
            SELECT polled_at AS time_bucket, queue,
              agents_idle, agents_busy, agents_total,
              jobs_scheduled, jobs_running, jobs_waiting, jobs_total,
              p50_wait_secs, p90_wait_secs, p95_wait_secs
            FROM queue_snapshots
            WHERE polled_at >= ${cutoff} AND queue = ${queue}
            ORDER BY polled_at
          `
        : await db`
            SELECT polled_at AS time_bucket, queue,
              agents_idle, agents_busy, agents_total,
              jobs_scheduled, jobs_running, jobs_waiting, jobs_total,
              p50_wait_secs, p90_wait_secs, p95_wait_secs
            FROM queue_snapshots
            WHERE polled_at >= ${cutoff}
            ORDER BY polled_at
          `;
    } else {
      // Aggregate into time buckets
      // ≤24h: 15-min, ≤7d: 1-hour, >7d: 6-hour
      const bucketMinutes = hours <= 24 ? 15 : hours <= 168 ? 60 : 360;
      const epochBucket = `to_timestamp(FLOOR(EXTRACT(epoch FROM polled_at) / ${bucketMinutes * 60}) * ${bucketMinutes * 60})`;

      snapshots = queue
        ? await db.unsafe(
            `SELECT ${epochBucket} AS time_bucket, queue,
              ROUND(AVG(agents_idle))::int AS agents_idle,
              ROUND(AVG(agents_busy))::int AS agents_busy,
              ROUND(AVG(agents_total))::int AS agents_total,
              ROUND(AVG(jobs_scheduled))::int AS jobs_scheduled,
              ROUND(AVG(jobs_running))::int AS jobs_running,
              ROUND(AVG(jobs_waiting))::int AS jobs_waiting,
              ROUND(AVG(jobs_total))::int AS jobs_total,
              ROUND(AVG(p50_wait_secs))::int AS p50_wait_secs,
              ROUND(AVG(p90_wait_secs))::int AS p90_wait_secs,
              ROUND(AVG(p95_wait_secs))::int AS p95_wait_secs
            FROM queue_snapshots
            WHERE polled_at >= $1 AND queue = $2
            GROUP BY time_bucket, queue
            ORDER BY time_bucket`,
            [cutoff, queue],
          )
        : await db.unsafe(
            `SELECT ${epochBucket} AS time_bucket, queue,
              ROUND(AVG(agents_idle))::int AS agents_idle,
              ROUND(AVG(agents_busy))::int AS agents_busy,
              ROUND(AVG(agents_total))::int AS agents_total,
              ROUND(AVG(jobs_scheduled))::int AS jobs_scheduled,
              ROUND(AVG(jobs_running))::int AS jobs_running,
              ROUND(AVG(jobs_waiting))::int AS jobs_waiting,
              ROUND(AVG(jobs_total))::int AS jobs_total,
              ROUND(AVG(p50_wait_secs))::int AS p50_wait_secs,
              ROUND(AVG(p90_wait_secs))::int AS p90_wait_secs,
              ROUND(AVG(p95_wait_secs))::int AS p95_wait_secs
            FROM queue_snapshots
            WHERE polled_at >= $1
            GROUP BY time_bucket, queue
            ORDER BY time_bucket`,
            [cutoff],
          );
    }

    // Distinct queue names
    const queueRows = await db`
      SELECT DISTINCT queue FROM queue_snapshots
      WHERE polled_at >= ${cutoff}
      ORDER BY queue
    `;

    // Latest snapshot per queue for stat cards
    // Use most recent row for agent/job counts, but pull wait times
    // from the most recent row that has them (poll-agents doesn't write wait times)
    const latest = await db`
      SELECT
        a.queue, a.polled_at,
        a.agents_idle, a.agents_busy, a.agents_total,
        a.jobs_scheduled, a.jobs_running, a.jobs_waiting, a.jobs_total,
        CASE WHEN a.jobs_scheduled + a.jobs_waiting > 0 THEN w.p50_wait_secs ELSE NULL END AS p50_wait_secs,
        CASE WHEN a.jobs_scheduled + a.jobs_waiting > 0 THEN w.p90_wait_secs ELSE NULL END AS p90_wait_secs,
        CASE WHEN a.jobs_scheduled + a.jobs_waiting > 0 THEN w.p95_wait_secs ELSE NULL END AS p95_wait_secs
      FROM (
        SELECT DISTINCT ON (queue) *
        FROM queue_snapshots
        ORDER BY queue, polled_at DESC
      ) a
      LEFT JOIN (
        SELECT DISTINCT ON (queue) queue, p50_wait_secs, p90_wait_secs, p95_wait_secs
        FROM queue_snapshots
        WHERE p90_wait_secs IS NOT NULL
        ORDER BY queue, polled_at DESC
      ) w ON a.queue = w.queue
    `;

    return NextResponse.json({
      snapshots,
      queues: queueRows.map((r) => r.queue),
      latest,
    });
  } catch (error) {
    console.error("Failed to fetch metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 },
    );
  }
}
