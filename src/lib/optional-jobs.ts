// Jobs marked as optional: true in .buildkite/test_areas/*.yaml
// These are longer-running or experimental jobs that don't block CI.
export const OPTIONAL_JOBS = new Set([
  "Multi-Modal Models (Extended) 1",
  "Multi-Modal Models (Extended) 2",
  "Multi-Modal Models (Extended) 3",
  "Distributed Tests (4 GPUs)(A100)",
  "Distributed Tests (2 GPUs)(H100)",
  "Distributed Tests (2 GPUs)(B200)",
  "2 Node Test (4 GPUs)",
  "Transformers Nightly Models",
  "V1 e2e (2 GPUs)",
  "V1 e2e (4 GPUs)",
  "Language Models Test (Extended Generation)",
  "Language Models Test (PPL)",
  "Language Models Test (Extended Pooling)",
  "Language Models Test (MTEB)",
  "DeepSeek V2-Lite Accuracy",
  "Qwen3-30B-A3B-FP8-block Accuracy",
  "Qwen3-30B-A3B-FP8-block Accuracy (B200)",
  "DeepSeek V2-Lite Prefetch Offload Accuracy (H100)",
  "Sequence Parallel Correctness Tests (2xH100)",
  "AsyncTP Correctness Tests (2xH100)",
  "AsyncTP Correctness Tests (B200)",
  "Fusion E2E Config Sweep (B200)",
  "Weight Loading Multiple GPU",
  "Acceptance Length Test (Large Models)",
  "LM Eval Large Models (4 GPUs)(H100)",
  "LM Eval Small Models (B200)",
  "LM Eval Large Models (H200)",
  "MoE Refactor Integration Test (H100 - TEMPORARY)",
  "MoE Refactor Integration Test (B200 - TEMPORARY)",
  "MoE Refactor Integration Test (B200 DP - TEMPORARY)",
  "GPQA Eval (GPT-OSS) (H100)",
  "GPQA Eval (GPT-OSS) (B200)",
  "Attention Benchmarks Smoke Test (B200)",
  "Elastic EP Scaling Test",
  "Kernels FP8 MoE Test (1 H100)",
  "Kernels FP8 MoE Test (2 H100s)",
  "Kernels Fp4 MoE Test (B200)",
]);

// Jobs marked as soft_fail: true in .buildkite/test_areas/*.yaml
// Failures in these jobs are recorded but don't fail the build.
export const SOFT_FAIL_JOBS = new Set([
  "Transformers Nightly Models",
  "Ray Dependency Compatibility Check",
  "Pytorch Nightly Dependency Override Check",
]);

export function isOptionalJob(name: string): boolean {
  return OPTIONAL_JOBS.has(name);
}

export function isSoftFailJob(name: string): boolean {
  return SOFT_FAIL_JOBS.has(name);
}
