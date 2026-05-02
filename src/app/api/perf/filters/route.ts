import { NextResponse } from "next/server";
import { queryDatabricks } from "@/lib/databricks";

export async function GET() {
  try {
    const rows = await queryDatabricks<{
      model: string;
      device: string;
      tp: string;
      conc: string;
      precision: string;
      image: string;
    }>(`
      SELECT DISTINCT
        message:model::STRING AS model,
        message:device::STRING AS device,
        message:tp::STRING AS tp,
        message:conc::STRING AS conc,
        message:precision::STRING AS precision,
        message:image::STRING AS image
      FROM vllm_data_warehouse.default.vllm_perf_data_ingest
      WHERE message:model IS NOT NULL
      ORDER BY model, device
    `);

    const models = [...new Set(rows.map((r) => r.model).filter(Boolean))].sort();
    const devices = [...new Set(rows.map((r) => r.device).filter(Boolean))].sort();
    const tps = [...new Set(rows.map((r) => r.tp).filter(Boolean))].sort((a, b) => +a - +b);
    const concs = [...new Set(rows.map((r) => r.conc).filter(Boolean))].sort((a, b) => +a - +b);
    const precisions = [...new Set(rows.map((r) => r.precision).filter(Boolean))].sort();
    const images = [...new Set(rows.map((r) => r.image).filter(Boolean))].sort();

    return NextResponse.json({ models, devices, tps, concs, precisions, images });
  } catch (error) {
    console.error("Failed to fetch perf filters:", error);
    return NextResponse.json({ error: "Failed to fetch filters" }, { status: 500 });
  }
}
