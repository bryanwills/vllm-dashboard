/**
 * Presentation logic shared by the Fast CI and Full CI views of the alerts tab.
 *
 * Both views answer the same two questions about an alert that Postgres can
 * answer alone: how far its Slack notification got, and where the commit or
 * pull request it refers to lives on GitHub.
 */

export type NotificationStatus =
  | "pending"
  | "retrying"
  | "delivered"
  | "dead_letter";

export type NotificationState = NotificationStatus | "unnotified";

/**
 * One rendered Slack batch covers up to eight events, and a consolidated
 * recovery summary can add a second delivery for the same event, so an event
 * can carry several outbox statuses. Delivery is the question a responder is
 * asking, so any delivered attempt wins; otherwise the worst outstanding
 * attempt is reported.
 */
const UNDELIVERED_SEVERITY: NotificationStatus[] = [
  "dead_letter",
  "retrying",
  "pending",
];

export function notificationStateFor(
  statuses: readonly NotificationStatus[],
): NotificationState {
  if (statuses.length === 0) return "unnotified";
  if (statuses.includes("delivered")) return "delivered";
  return (
    UNDELIVERED_SEVERITY.find((status) => statuses.includes(status)) ?? "pending"
  );
}

export const NOTIFICATION_STATE_LABELS: Record<NotificationState, string> = {
  pending: "Slack pending",
  retrying: "Slack retrying",
  delivered: "Slack delivered",
  dead_letter: "Slack dead-lettered",
  unnotified: "No Slack notification",
};

/** Alert timestamps are read at a glance, so the year is left implicit. */
export function formatAlertDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const VLLM_REPO_URL = "https://github.com/vllm-project/vllm";

export function commitUrl(commitSha: string): string {
  return `${VLLM_REPO_URL}/commit/${commitSha}`;
}

export function pullRequestUrl(prNumber: string | null): string | null {
  return prNumber ? `${VLLM_REPO_URL}/pull/${prNumber}` : null;
}
