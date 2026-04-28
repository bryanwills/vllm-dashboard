"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";

export interface BuildDuration {
  id: string;
  state: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  duration_mins: string;
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDurationRound(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  if (mins <= 120) return `${h}h${m}m`;
  return `${h}h`;
}

function isFailed(state: string): boolean {
  return ["failed", "failing"].includes(state);
}

interface ChartPoint {
  index: number;
  date: string;
  dateShort: string;
  duration: number;
  failed: boolean;
  state: string;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <p className={`font-medium ${d.failed ? "text-red-600" : "text-emerald-600"}`}>
        {d.failed ? "Failed" : "Passed"} — {formatDuration(d.duration)}
      </p>
      <p className="text-zinc-500">{d.date}</p>
    </div>
  );
}

interface BuildChartProps {
  data: BuildDuration[];
  startDate?: string;
  endDate?: string;
}

export function BuildChart({ data, startDate, endDate }: BuildChartProps) {
  const rangeLabel =
    startDate && endDate ? `${startDate} — ${endDate}` : "All Time";

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Build Duration — {rangeLabel}
        </h3>
        <div className="flex h-[200px] items-center justify-center text-sm text-zinc-400">
          No build data
        </div>
      </div>
    );
  }

  const chartData: ChartPoint[] = data.map((b, i) => {
    const d = new Date(b.created_at);
    return {
      index: i,
      date: d.toLocaleString(),
      dateShort: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      duration: parseInt(b.duration_mins, 10) || 0,
      failed: isFailed(b.state),
      state: b.state,
    };
  });

  const maxDur = Math.max(...chartData.map((d) => d.duration), 1);
  const tickInterval = Math.max(1, Math.floor(chartData.length / 10));

  // Round ticks for y-axis
  const candidates = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720];
  let tickStep = candidates[candidates.length - 1];
  for (const c of candidates) {
    if (maxDur / c <= 6) { tickStep = c; break; }
  }
  const ticks: number[] = [];
  for (let v = 0; v <= maxDur * 1.1; v += tickStep) ticks.push(v);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Build Duration — {rangeLabel} — {data.length} builds
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="index"
            tick={{ fontSize: 10 }}
            tickFormatter={(i: number) => chartData[i]?.dateShort ?? ""}
            interval={tickInterval}
            stroke="#71717a"
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => formatDurationRound(v)}
            stroke="#71717a"
            width={40}
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1] || maxDur]}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(113,113,122,0.1)" }} />
          <Bar dataKey="duration" radius={[2, 2, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.failed ? "#ef4444" : "#10b981"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
