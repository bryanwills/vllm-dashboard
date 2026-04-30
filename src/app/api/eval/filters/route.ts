import { NextResponse } from "next/server";
import { queryDatabricks } from "@/lib/databricks";

interface RawRow {
  m: string;
}

interface LmEvalCore {
  config?: { model_args?: { model?: string } };
  results?: Record<string, Record<string, unknown>>;
}

interface LmEvalMessage extends LmEvalCore {
  data?: LmEvalCore;
}

export async function GET() {
  try {
    const rawRows = await queryDatabricks<RawRow>(`
      SELECT CAST(message AS STRING) AS m
      FROM vllm_data_warehouse.default.vllm_eval_data_ingest
      WHERE message:results IS NOT NULL OR message:data:results IS NOT NULL
    `);

    const models = new Set<string>();
    const tasks = new Set<string>();
    const filters = new Set<string>();
    const metrics = new Set<string>();

    for (const r of rawRows) {
      let raw: LmEvalMessage;
      try {
        raw = JSON.parse(r.m);
      } catch {
        continue;
      }
      const core: LmEvalCore = raw.data ?? raw;
      if (!core?.results) continue;
      const modelName = core.config?.model_args?.model;
      if (modelName) models.add(modelName);
      for (const taskName of Object.keys(core.results)) {
        tasks.add(taskName);
        for (const key of Object.keys(core.results[taskName])) {
          if (key === "alias") continue;
          const match = key.match(/^(.+?)(?:_stderr)?,(.+)$/);
          if (match) {
            metrics.add(match[1]);
            filters.add(match[2]);
          }
        }
      }
    }

    return NextResponse.json({
      models: [...models].sort(),
      tasks: [...tasks].sort(),
      filters: [...filters].sort(),
      metrics: [...metrics].sort(),
    });
  } catch (error) {
    console.error("Failed to fetch eval filters:", error);
    return NextResponse.json(
      { error: "Failed to fetch eval filters" },
      { status: 500 }
    );
  }
}
