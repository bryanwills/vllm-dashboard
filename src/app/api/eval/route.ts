import { NextRequest, NextResponse } from "next/server";
import { loadEvalRows } from "@/lib/eval-data";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const rows = await loadEvalRows({
      model: sp.get("model"),
      task: sp.get("task"),
      image: sp.get("image"),
    });

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Failed to fetch eval data:", error);
    return NextResponse.json(
      { error: "Failed to fetch evaluation data" },
      { status: 500 }
    );
  }
}
