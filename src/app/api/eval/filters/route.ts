import { NextResponse } from "next/server";
import { resolveEvalImage } from "@/lib/eval-images";
import { queryDatabricks } from "@/lib/databricks";

interface RawRow {
  m: string;
}

interface LmEvalCore {
  config?: { model_args?: { model?: string } };
  configs?: Record<string, Record<string, unknown>>;
  results?: Record<string, Record<string, unknown>>;
}

interface LmEvalMessage extends LmEvalCore {
  data?: LmEvalCore;
  workload?: string;
  source_file?: string;
  buildkite_commit?: string;
  [key: string]: unknown;
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
    const images = new Set<string>();
    const imageLookups: Promise<void>[] = [];

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
        imageLookups.push(
          resolveEvalImage(raw, core, taskName).then((image) => {
            if (image) images.add(image);
          })
        );
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

    await Promise.all(imageLookups);

    return NextResponse.json({
      models: [...models].sort(),
      tasks: [...tasks].sort(),
      images: [...images].sort(),
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
