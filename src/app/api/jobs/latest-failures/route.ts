import { NextResponse } from "next/server";
import { queryDatabricks } from "@/lib/databricks";

interface BuildRow {
  id: string;
  number: string;
  state: string;
  branch: string;
  commit: string;
  created_at: string;
  finished_at: string;
  web_url: string;
  message: string;
}

interface JobRow {
  name: string;
  state: string;
  web_url: string;
  started_at: string;
  finished_at: string;
  soft_failed: string;
}

export async function GET() {
  try {
    const where = [
      "b._fivetran_deleted = false",
      "b.state IN ('passed', 'failed')",
      "b.message LIKE '%Full CI%'",
      "p.name = 'CI'",
      "b.branch = 'main'",
    ].join(" AND ");

    // Fetch the 2 most recent Full CI builds
    const builds = await queryDatabricks<BuildRow>(`
      SELECT
        b.id,
        b.number,
        b.state,
        b.branch,
        b.commit,
        b.created_at,
        b.finished_at,
        b.web_url,
        b.message
      FROM vllm_data_warehouse.buildkite.build AS b
      INNER JOIN vllm_data_warehouse.buildkite.pipeline AS p ON b.pipeline_id = p.id
      WHERE ${where}
      ORDER BY b.created_at DESC
      LIMIT 2
    `);

    if (builds.length === 0) {
      return NextResponse.json({
        build: null,
        previousBuild: null,
        failedJobs: [],
        fixedJobs: [],
      });
    }

    const build = builds[0];
    const previousBuild = builds.length > 1 ? builds[1] : null;

    // Fetch failed jobs for latest build
    const failedJobs = await queryDatabricks<JobRow>(`
      SELECT
        j.name,
        j.state,
        j.web_url,
        j.started_at,
        j.finished_at,
        j.soft_failed
      FROM vllm_data_warehouse.buildkite.build_job AS j
      WHERE j.build_id = '${build.id.replace(/'/g, "''")}'
        AND j._fivetran_deleted = false
        AND j.type = 'script'
        AND j.state IN ('failed', 'failing', 'broken', 'timed_out')
      ORDER BY j.name
    `);

    let previousFailedNames: Set<string> = new Set();
    let fixedJobs: JobRow[] = [];

    if (previousBuild) {
      // Fetch failed jobs from the previous build
      const previousFailedJobs = await queryDatabricks<JobRow>(`
        SELECT
          j.name,
          j.state,
          j.web_url,
          j.started_at,
          j.finished_at,
          j.soft_failed
        FROM vllm_data_warehouse.buildkite.build_job AS j
        WHERE j.build_id = '${previousBuild.id.replace(/'/g, "''")}'
          AND j._fivetran_deleted = false
          AND j.type = 'script'
          AND j.state IN ('failed', 'failing', 'broken', 'timed_out')
        ORDER BY j.name
      `);
      previousFailedNames = new Set(previousFailedJobs.map((j) => j.name));

      // Fixed jobs: failed in previous build but passed (or not failed) in latest
      const latestFailedNames = new Set(failedJobs.map((j) => j.name));
      fixedJobs = previousFailedJobs.filter((j) => !latestFailedNames.has(j.name));
    }

    // Tag each failed job as "new" or "recurring"
    const taggedFailedJobs = failedJobs.map((job) => ({
      ...job,
      category: previousBuild
        ? previousFailedNames.has(job.name)
          ? "recurring"
          : "new"
        : "unknown",
    }));

    return NextResponse.json({
      build,
      previousBuild,
      failedJobs: taggedFailedJobs,
      fixedJobs,
    });
  } catch (error) {
    console.error("Failed to fetch latest build failures:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest build failures" },
      { status: 500 }
    );
  }
}
