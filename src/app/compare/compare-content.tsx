"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { SearchableSelect } from "@/components/searchable-select";
import { StatCard } from "@/components/stat-card";

type Area = "perf" | "eval";
type DeltaStatus = "regression" | "improvement" | "unchanged" | "noisy";

interface PerfFilters {
  models: string[];
  devices: string[];
  images: string[];
}

interface EvalFilters {
  models: string[];
  tasks: string[];
  images: string[];
}

interface DeltaItem {
  area: Area;
  key: string;
  model: string;
  dimension: string;
  metric: string;
  metricLabel: string;
  unit: string;
  higherIsBetter: boolean;
  baselineValue: number;
  candidateValue: number;
  delta: number;
  deltaPct: number | null;
  status: DeltaStatus;
  severity: number;
  significance: number | null;
  baselineRun: string | null;
  candidateRun: string | null;
  baselineDetail: string;
  candidateDetail: string;
}

interface CoverageItem {
  area: Area;
  key: string;
  model: string;
  dimension: string;
  metric: string;
  metricLabel: string;
  presentImage: string;
  runDate: string | null;
}

interface CompareResponse {
  baseline: string;
  candidate: string;
  thresholds: {
    perf: number;
    evalSigma: number;
  };
  summary: {
    matched: number;
    perfMatched: number;
    evalMatched: number;
    regressions: number;
    improvements: number;
    noisy: number;
    unchanged: number;
    missingBaseline: number;
    missingCandidate: number;
  };
  worstRegressions: DeltaItem[];
  perf: {
    deltas: DeltaItem[];
    missingBaseline: CoverageItem[];
    missingCandidate: CoverageItem[];
  };
  eval: {
    deltas: DeltaItem[];
    missingBaseline: CoverageItem[];
    missingCandidate: CoverageItem[];
  };
  generatedAt: string;
}

interface CompareFilters {
  baseline: string;
  candidate: string;
  model: string;
  device: string;
  task: string;
  perfThresholdPct: string;
  evalSigma: string;
}

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Request failed");
  }
  return data;
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function formatNumericInput(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function parsePerfThresholdParam(value: string | null): string | null {
  if (value === null) return null;
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return formatNumericInput(parsed <= 1 ? parsed * 100 : parsed);
}

function parseNonNegativeParam(value: string | null): string | null {
  if (value === null) return null;
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return formatNumericInput(parsed);
}

function setQueryParam(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
}

function shortImage(image: string): string {
  const slash = image.lastIndexOf("/");
  const colon = image.lastIndexOf(":");
  if (colon > slash) return image.slice(colon + 1);
  return image;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatValue(item: DeltaItem, value: number): string {
  if (item.area === "eval") return `${(value * 100).toFixed(2)}%`;
  if (item.unit === "s") {
    return value < 1 ? `${value.toFixed(4)}s` : `${value.toFixed(2)}s`;
  }
  return `${value.toFixed(2)} ${item.unit}`;
}

function formatDelta(item: DeltaItem): string {
  const sign = item.delta >= 0 ? "+" : "";
  if (item.area === "eval") {
    return `${sign}${(item.delta * 100).toFixed(2)} pp`;
  }
  if (item.deltaPct === null) {
    return `${sign}${item.delta.toFixed(4)}`;
  }
  return `${sign}${(item.deltaPct * 100).toFixed(1)}%`;
}

function statusLabel(status: DeltaStatus): string {
  switch (status) {
    case "regression":
      return "Regression";
    case "improvement":
      return "Improvement";
    case "noisy":
      return "Noisy";
    case "unchanged":
      return "Unchanged";
  }
}

function StatusPill({ status }: { status: DeltaStatus }) {
  const classes = {
    regression: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
    improvement: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
    noisy: "bg-yellow-50 text-yellow-700 ring-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:ring-yellow-900",
    unchanged: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800",
  }[status];

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${classes}`}>
      {statusLabel(status)}
    </span>
  );
}

function DeltaTable({
  title,
  items,
  emptyText,
  limit = 100,
}: {
  title: string;
  items: DeltaItem[];
  emptyText: string;
  limit?: number;
}) {
  const visible = items.slice(0, limit);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-950">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <h3 className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        {items.length > limit ? (
          <span className="text-xs text-zinc-400">
            Showing {limit} of {items.length}
          </span>
        ) : (
          <span className="text-xs text-zinc-400">{items.length} checks</span>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-zinc-400">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Area</th>
                <th className="px-4 py-2 text-left">Model</th>
                <th className="px-4 py-2 text-left">Config / task</th>
                <th className="px-4 py-2 text-left">Metric</th>
                <th className="px-4 py-2 text-right">Baseline</th>
                <th className="px-4 py-2 text-right">Candidate</th>
                <th className="px-4 py-2 text-right">Delta</th>
                <th className="px-4 py-2 text-right">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map((item) => (
                <tr key={item.key} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2">
                    <StatusPill status={item.status} />
                  </td>
                  <td className="px-4 py-2 text-xs uppercase text-zinc-500">
                    {item.area}
                  </td>
                  <td className="max-w-[220px] px-4 py-2 font-mono text-xs">
                    <span className="block truncate" title={item.model}>
                      {item.model}
                    </span>
                  </td>
                  <td className="min-w-[260px] px-4 py-2 text-zinc-600 dark:text-zinc-300">
                    {item.dimension}
                  </td>
                  <td className="px-4 py-2">
                    <div>{item.metricLabel}</div>
                    <div className="text-xs text-zinc-400">
                      {item.higherIsBetter ? "higher is better" : "lower is better"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs">
                    {formatValue(item, item.baselineValue)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs">
                    {formatValue(item, item.candidateValue)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-right font-mono text-xs ${
                      item.status === "regression"
                        ? "text-red-600 dark:text-red-400"
                        : item.status === "improvement"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-500"
                    }`}
                  >
                    {formatDelta(item)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-zinc-500">
                    {item.area === "eval"
                      ? item.significance === null
                        ? "stderr unavailable"
                        : `${item.significance.toFixed(1)} sigma`
                      : item.deltaPct === null
                        ? "baseline zero"
                        : `${Math.abs(item.deltaPct * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CoverageTable({
  title,
  items,
  emptyText,
  limit = 60,
}: {
  title: string;
  items: CoverageItem[];
  emptyText: string;
  limit?: number;
}) {
  const visible = items.slice(0, limit);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-950">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <h3 className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        {items.length > limit ? (
          <span className="text-xs text-zinc-400">
            Showing {limit} of {items.length}
          </span>
        ) : (
          <span className="text-xs text-zinc-400">{items.length} checks</span>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-zinc-400">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 text-left">Area</th>
                <th className="px-4 py-2 text-left">Model</th>
                <th className="px-4 py-2 text-left">Config / task</th>
                <th className="px-4 py-2 text-left">Metric</th>
                <th className="px-4 py-2 text-left">Present image</th>
                <th className="px-4 py-2 text-right">Run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map((item) => (
                <tr key={`${item.key}-${item.presentImage}`}>
                  <td className="px-4 py-2 text-xs uppercase text-zinc-500">
                    {item.area}
                  </td>
                  <td className="max-w-[220px] px-4 py-2 font-mono text-xs">
                    <span className="block truncate" title={item.model}>
                      {item.model}
                    </span>
                  </td>
                  <td className="min-w-[260px] px-4 py-2 text-zinc-600 dark:text-zinc-300">
                    {item.dimension}
                  </td>
                  <td className="px-4 py-2">{item.metricLabel}</td>
                  <td className="max-w-[260px] px-4 py-2 font-mono text-xs text-zinc-500">
                    <span className="block truncate" title={item.presentImage}>
                      {shortImage(item.presentImage)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-zinc-500">
                    {formatDate(item.runDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [baseline, setBaseline] = useState(searchParams.get("baseline") ?? "");
  const [candidate, setCandidate] = useState(searchParams.get("candidate") ?? "");
  const [model, setModel] = useState(searchParams.get("model") ?? "");
  const [device, setDevice] = useState(searchParams.get("device") ?? "");
  const [task, setTask] = useState(searchParams.get("task") ?? "");
  const [perfThresholdPct, setPerfThresholdPct] = useState(
    parsePerfThresholdParam(
      searchParams.get("perf_threshold") ?? searchParams.get("perfThreshold")
    ) ?? "2"
  );
  const [evalSigma, setEvalSigma] = useState(
    parseNonNegativeParam(
      searchParams.get("eval_sigma") ?? searchParams.get("evalSigma")
    ) ?? "2"
  );

  const updateCompareUrl = (updates: Partial<CompareFilters>) => {
    const next: CompareFilters = {
      baseline,
      candidate,
      model,
      device,
      task,
      perfThresholdPct,
      evalSigma,
      ...updates,
    };
    const params = new URLSearchParams();
    const perfThresholdParam = parseFloat(next.perfThresholdPct);
    const evalSigmaParam = parseFloat(next.evalSigma);

    setQueryParam(params, "baseline", next.baseline);
    setQueryParam(params, "candidate", next.candidate);
    setQueryParam(params, "model", next.model);
    setQueryParam(params, "device", next.device);
    setQueryParam(params, "task", next.task);
    if (
      Number.isFinite(perfThresholdParam) &&
      perfThresholdParam >= 0 &&
      perfThresholdParam !== 2
    ) {
      params.set("perf_threshold", String(perfThresholdParam / 100));
    }
    if (
      Number.isFinite(evalSigmaParam) &&
      evalSigmaParam >= 0 &&
      evalSigmaParam !== 2
    ) {
      params.set("eval_sigma", String(evalSigmaParam));
    }

    const queryString = params.toString();
    router.replace(queryString ? `/compare?${queryString}` : "/compare", {
      scroll: false,
    });
  };

  const updateBaseline = (value: string) => {
    setBaseline(value);
    updateCompareUrl({ baseline: value });
  };

  const updateCandidate = (value: string) => {
    setCandidate(value);
    updateCompareUrl({ candidate: value });
  };

  const updateModel = (value: string) => {
    setModel(value);
    updateCompareUrl({ model: value });
  };

  const updateDevice = (value: string) => {
    setDevice(value);
    updateCompareUrl({ device: value });
  };

  const updateTask = (value: string) => {
    setTask(value);
    updateCompareUrl({ task: value });
  };

  const updatePerfThresholdPct = (value: string) => {
    setPerfThresholdPct(value);
    updateCompareUrl({ perfThresholdPct: value });
  };

  const updateEvalSigma = (value: string) => {
    setEvalSigma(value);
    updateCompareUrl({ evalSigma: value });
  };

  const { data: perfFilters } = useSWR<PerfFilters>("/api/perf/filters", fetcher);
  const { data: evalFilters } = useSWR<EvalFilters>("/api/eval/filters", fetcher);

  const imageOptions = useMemo(
    () => uniqueSorted([...(perfFilters?.images ?? []), ...(evalFilters?.images ?? [])]),
    [perfFilters?.images, evalFilters?.images]
  );
  const modelOptions = useMemo(
    () => uniqueSorted([...(perfFilters?.models ?? []), ...(evalFilters?.models ?? [])]),
    [perfFilters?.models, evalFilters?.models]
  );
  const deviceOptions = perfFilters?.devices ?? [];
  const taskOptions = evalFilters?.tasks ?? [];

  const perfThreshold = Number.isFinite(parseFloat(perfThresholdPct))
    ? Math.max(0, parseFloat(perfThresholdPct))
    : 2;
  const evalSigmaValue = Number.isFinite(parseFloat(evalSigma))
    ? Math.max(0, parseFloat(evalSigma))
    : 2;

  const compareUrl = useMemo(() => {
    if (!baseline || !candidate || baseline === candidate) return null;

    const params = new URLSearchParams();
    params.set("baseline", baseline);
    params.set("candidate", candidate);
    params.set("perf_threshold", String(perfThreshold / 100));
    params.set("eval_sigma", String(evalSigmaValue));
    if (model) params.set("model", model);
    if (device) params.set("device", device);
    if (task) params.set("task", task);
    return `/api/compare?${params.toString()}`;
  }, [baseline, candidate, model, device, task, perfThreshold, evalSigmaValue]);

  const { data, error, isLoading } = useSWR<CompareResponse>(
    compareUrl,
    fetcher,
    { refreshInterval: 10 * 60 * 1000 }
  );

  const missingBaseline = data
    ? [...data.perf.missingBaseline, ...data.eval.missingBaseline]
    : [];
  const missingCandidate = data
    ? [...data.perf.missingCandidate, ...data.eval.missingCandidate]
    : [];
  const hasFilters = imageOptions.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Release Compare
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Compare two vLLM images across performance benchmarks and accuracy evaluations.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200/80 bg-white px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-950">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <SearchableSelect
            label="Baseline image"
            value={baseline}
            onChange={updateBaseline}
            options={imageOptions}
            allLabel="Select baseline"
          />
          <SearchableSelect
            label="Candidate image"
            value={candidate}
            onChange={updateCandidate}
            options={imageOptions}
            allLabel="Select candidate"
          />
          <button
            type="button"
            onClick={() => {
              setBaseline(candidate);
              setCandidate(baseline);
              updateCompareUrl({ baseline: candidate, candidate: baseline });
            }}
            disabled={!baseline && !candidate}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Swap
          </button>
          <SearchableSelect
            label="Model"
            value={model}
            onChange={updateModel}
            options={modelOptions}
            allLabel="All Models"
          />
          <SearchableSelect
            label="Device"
            value={device}
            onChange={updateDevice}
            options={deviceOptions}
            allLabel="All Devices"
          />
          <SearchableSelect
            label="Task"
            value={task}
            onChange={updateTask}
            options={taskOptions}
            allLabel="All Tasks"
          />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Perf threshold (%)
            </span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={perfThresholdPct}
              onChange={(event) => updatePerfThresholdPct(event.target.value)}
              className="w-32 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Eval sigma
            </span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={evalSigma}
              onChange={(event) => updateEvalSigma(event.target.value)}
              className="w-28 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
      </div>

      {!hasFilters && (
        <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
          <span className="text-sm text-zinc-400">Loading image filters...</span>
        </div>
      )}

      {hasFilters && (!baseline || !candidate) && (
        <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
          <span className="text-sm text-zinc-400">
            Select a baseline image and a candidate image to compare release metrics.
          </span>
        </div>
      )}

      {baseline && candidate && baseline === candidate && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200">
          Pick two different images. Baseline and candidate are currently the same.
        </div>
      )}

      {compareUrl && isLoading && (
        <div className="flex h-64 items-center justify-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
          <span className="text-sm text-zinc-400">Comparing images...</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error.message}
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Matched checks"
              value={data.summary.matched}
              detail={`${data.summary.perfMatched} perf, ${data.summary.evalMatched} eval`}
            />
            <StatCard
              label="Regressions"
              value={data.summary.regressions}
              detail={`>${perfThreshold.toFixed(1)}% perf or >=${evalSigmaValue.toFixed(1)} sigma eval`}
              color={data.summary.regressions > 0 ? "red" : "default"}
            />
            <StatCard
              label="Improvements"
              value={data.summary.improvements}
              detail="Direction-aware metric wins"
              color={data.summary.improvements > 0 ? "green" : "default"}
            />
            <StatCard
              label="Noisy eval"
              value={data.summary.noisy}
              detail="Moved within stderr threshold"
              color={data.summary.noisy > 0 ? "yellow" : "default"}
            />
            <StatCard
              label="Coverage gaps"
              value={data.summary.missingBaseline + data.summary.missingCandidate}
              detail={`${data.summary.missingBaseline} candidate-only, ${data.summary.missingCandidate} baseline-only`}
              color={
                data.summary.missingBaseline + data.summary.missingCandidate > 0
                  ? "yellow"
                  : "default"
              }
            />
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-white px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-950">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase text-zinc-400">
                  Baseline
                </div>
                <div className="truncate font-mono text-sm" title={data.baseline}>
                  {data.baseline}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase text-zinc-400">
                  Candidate
                </div>
                <div className="truncate font-mono text-sm" title={data.candidate}>
                  {data.candidate}
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs text-zinc-400">
              Generated {formatDate(data.generatedAt)}
            </div>
          </div>

          <DeltaTable
            title="Worst regressions"
            items={data.worstRegressions}
            emptyText="No regressions exceeded the configured thresholds."
            limit={25}
          />

          <DeltaTable
            title="Performance delta"
            items={data.perf.deltas}
            emptyText="No matched performance benchmark metrics for these images."
          />

          <DeltaTable
            title="Accuracy delta"
            items={data.eval.deltas}
            emptyText="No matched evaluation metrics for these images."
          />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <CoverageTable
              title="Missing from baseline"
              items={missingBaseline}
              emptyText="Every candidate check has a matching baseline check."
            />
            <CoverageTable
              title="Missing from candidate"
              items={missingCandidate}
              emptyText="Every baseline check has a matching candidate check."
            />
          </div>
        </>
      )}
    </div>
  );
}
