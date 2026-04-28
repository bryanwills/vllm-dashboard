// AWS on-demand pricing per hour (us-west-2) by queue name.
// Only queues with known instance types are listed.
// Others will show compute hours but no dollar cost.

export interface QueuePricing {
  instanceType: string;
  costPerHour: number;
}

export const QUEUE_COSTS: Record<string, QueuePricing> = {
  // GPU queues — g6 instances with NVIDIA L4
  gpu_1_queue: { instanceType: "g6.4xlarge", costPerHour: 1.3232 },
  gpu_4_queue: { instanceType: "g6.12xlarge", costPerHour: 4.602 },

  // CPU queues — r6in instances
  cpu_queue_premerge: { instanceType: "r6in.16xlarge", costPerHour: 5.579 },
  cpu_queue_premerge_us_east_1: { instanceType: "r6in.16xlarge", costPerHour: 5.579 },
  cpu_queue_postmerge: { instanceType: "r6in.16xlarge", costPerHour: 5.579 },
  cpu_queue_postmerge_us_east_1: { instanceType: "r6in.16xlarge", costPerHour: 5.579 },
  cpu_queue_release: { instanceType: "r6in.16xlarge", costPerHour: 5.579 },
  small_cpu_queue_premerge: { instanceType: "r6in.large", costPerHour: 0.1743 },
  small_cpu_queue_postmerge: { instanceType: "r6in.large", costPerHour: 0.1743 },
  small_cpu_queue_release: { instanceType: "r6in.large", costPerHour: 0.1743 },

  // H200 queues
  h200_18gb: { instanceType: "h200_18gb", costPerHour: 0.30 },

  // ARM64 queues — r7g Graviton instances
  arm64_cpu_queue_postmerge: { instanceType: "r7g.16xlarge", costPerHour: 4.3546 },
  arm64_cpu_queue_release: { instanceType: "r7g.16xlarge", costPerHour: 4.3546 },
};

export function getQueueCost(queue: string): QueuePricing | null {
  return QUEUE_COSTS[queue] ?? null;
}
