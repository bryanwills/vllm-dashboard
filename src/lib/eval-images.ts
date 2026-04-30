import { load } from "js-yaml";

const PERF_EVAL_RAW_BASE =
  "https://raw.githubusercontent.com/vllm-project/perf-eval";
const VLLM_COMMIT_IMAGE_PREFIX = "vllm/vllm-openai:nightly-";
const workloadImageCache = new Map<string, Promise<string | null>>();

interface EvalImageCore {
  config?: { model_args?: Record<string, unknown> };
  configs?: Record<string, Record<string, unknown>>;
}

export interface EvalImageMessage extends EvalImageCore {
  data?: EvalImageCore;
  workload?: string;
  source_file?: string;
  buildkite_commit?: string;
  vllm_commit?: string;
  [key: string]: unknown;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function workloadFromSourceFile(sourceFile?: string): string | null {
  const match = sourceFile?.match(/^results\/([^/]+)/);
  return match?.[1] ?? null;
}

function workloadPathCandidates(workload: string): string[] {
  const base = workload.trim().replace(/\.ya?ml$/, "");
  const underscored = base.replace(/-/g, "_");
  return [...new Set([base, underscored])].map(
    (name) => `workloads/${name}.yaml`
  );
}

async function resolveWorkloadImage(
  commit: string,
  workload: string
): Promise<string | null> {
  for (const path of workloadPathCandidates(workload)) {
    const response = await fetch(`${PERF_EVAL_RAW_BASE}/${commit}/${path}`);
    if (response.status === 404) continue;
    if (!response.ok) continue;

    const parsed = recordValue(load(await response.text()));
    const vllm = recordValue(parsed.vllm);
    return stringValue(vllm.image);
  }
  return null;
}

function getWorkloadImage(commit: string, workload: string) {
  const key = `${commit}|${workload}`;
  let cached = workloadImageCache.get(key);
  if (!cached) {
    cached = resolveWorkloadImage(commit, workload).catch((error) => {
      console.warn("Failed to resolve eval workload image:", error);
      return null;
    });
    workloadImageCache.set(key, cached);
  }
  return cached;
}

export function imageFromMessage(
  raw: EvalImageMessage,
  core: EvalImageCore,
  taskName: string
): string | null {
  const rawRecord = raw as Record<string, unknown>;
  const coreRecord = core as Record<string, unknown>;
  const taskConfig = core.configs?.[taskName] ?? {};
  const metadata = recordValue(taskConfig.metadata);
  const modelArgs = core.config?.model_args ?? {};

  return (
    stringValue(rawRecord.image) ??
    stringValue(rawRecord.vllm_image) ??
    stringValue(rawRecord.docker_image) ??
    stringValue(coreRecord.image) ??
    stringValue(coreRecord.vllm_image) ??
    stringValue(coreRecord.docker_image) ??
    stringValue(modelArgs.image) ??
    stringValue(metadata.image)
  );
}

export async function resolveEvalImage(
  raw: EvalImageMessage,
  core: EvalImageCore,
  taskName: string
): Promise<string | null> {
  const image = imageFromMessage(raw, core, taskName);
  if (image) return image;

  const vllmCommit = stringValue(raw.vllm_commit);
  if (vllmCommit) return `${VLLM_COMMIT_IMAGE_PREFIX}${vllmCommit}`;

  const workload = raw.workload ?? workloadFromSourceFile(raw.source_file);
  if (!raw.buildkite_commit || !workload) return null;

  return getWorkloadImage(raw.buildkite_commit, workload);
}
