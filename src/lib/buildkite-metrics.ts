export interface QueueAgentMetrics {
  idle: number;
  busy: number;
  total: number;
}

export interface QueueJobMetrics {
  scheduled: number;
  running: number;
  waiting: number;
  total: number;
}

export interface AgentMetricsResponse {
  agents: {
    idle: number;
    busy: number;
    total: number;
    queues: Record<string, QueueAgentMetrics>;
  };
  jobs: {
    scheduled: number;
    running: number;
    waiting: number;
    total: number;
    queues: Record<string, QueueJobMetrics>;
  };
  organization: {
    slug: string;
  };
}

export async function fetchAgentMetrics(
  token: string,
): Promise<AgentMetricsResponse> {
  const res = await fetch("https://agent.buildkite.com/v3/metrics", {
    headers: { Authorization: `Token ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Buildkite Agent Metrics API failed (${res.status}): ${text}`,
    );
  }

  return res.json();
}
