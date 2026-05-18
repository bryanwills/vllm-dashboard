import { NextResponse } from "next/server";
import { queryDatabricks } from "@/lib/databricks";
import { getCached, setCache } from "@/lib/api-cache";

const TTL = 60_000;

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
    const cacheKey = "jobs:latest-failures";
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json(cached);

    const where = [
      "b._fivetran_deleted = false",
      "b.state IN ('passed', 'failed')",
      "b.message LIKE '%Full CI%'",
      "p.name = 'CI'",
      "b.branch = 'main'",
    ].join(" AND ");

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
      const result = { build: null, previousBuild: null, failedJobs: [], fixedJobs: [] };
      setCache(cacheKey, result, TTL);
      return NextResponse.json(result);
    }

    const build = builds[0];
    const previousBuild = builds.length > 1 ? builds[1] : null;

    const jobQueries = [
      queryDatabricks<JobRow>(`
        SELECT j.name, j.state, j.web_url, j.started_at, j.finished_at, j.soft_failed
        FROM vllm_data_warehouse.buildkite.build_job AS j
        WHERE j.build_id = '${build.id.replace(/'/g, "''")}'
          AND j._fivetran_deleted = false
          AND j.type = 'script'
          AND j.state IN ('failed', 'failing', 'broken', 'timed_out')
        ORDER BY j.name
      `),
      previousBuild
        ? queryDatabricks<JobRow>(`
            SELECT j.name, j.state, j.web_url, j.started_at, j.finished_at, j.soft_failed
            FROM vllm_data_warehouse.buildkite.build_job AS j
            WHERE j.build_id = '${previousBuild.id.replace(/'/g, "''")}'
              AND j._fivetran_deleted = false
              AND j.type = 'script'
              AND j.state IN ('failed', 'failing', 'broken', 'timed_out')
            ORDER BY j.name
          `)
        : Promise.resolve([] as JobRow[]),
    ];

    const [failedJobs, previousFailedJobs] = await Promise.all(jobQueries);

    const previousFailedNames = new Set(previousFailedJobs.map((j) => j.name));
    const latestFailedNames = new Set(failedJobs.map((j) => j.name));
    const fixedJobs = previousFailedJobs.filter((j) => !latestFailedNames.has(j.name));

    const taggedFailedJobs = failedJobs.map((job) => ({
      ...job,
      category: previousBuild
        ? previousFailedNames.has(job.name)
          ? "recurring"
          : "new"
        : "unknown",
    }));

    const result = { build, previousBuild, failedJobs: taggedFailedJobs, fixedJobs };
    setCache(cacheKey, result, TTL);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to fetch latest build failures:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest build failures" },
      { status: 500 }
    );
  }
}
