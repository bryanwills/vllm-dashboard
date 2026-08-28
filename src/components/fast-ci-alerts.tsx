import {
  commitUrl,
  NOTIFICATION_STATE_LABELS,
  pullRequestUrl,
  type FastFailureGroup,
  type NotificationState,
} from "@/lib/alerts-fast-ci";

const NOTIFICATION_STATE_CLASSES: Record<NotificationState, string> = {
  delivered:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  retrying:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  dead_letter: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  unnotified: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NotificationBadge({ state }: { state: NotificationState }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${NOTIFICATION_STATE_CLASSES[state]}`}
    >
      {NOTIFICATION_STATE_LABELS[state]}
    </span>
  );
}

function GroupCard({ group }: { group: FastFailureGroup }) {
  const prUrl = pullRequestUrl(group.prNumber);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-200 px-4 py-3 sm:px-5 dark:border-zinc-800">
        <a
          href={commitUrl(group.commitSha)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-base font-semibold tracking-tight text-blue-600 hover:underline dark:text-blue-400"
        >
          {group.commitSha.slice(0, 7)}
        </a>
        <a
          href={group.buildUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Buildkite build
        </a>
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            PR #{group.prNumber}
          </a>
        )}
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {group.pipeline} · {group.branch} · {group.author}
        </span>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          {group.events.length} fast{" "}
          {group.events.length === 1 ? "failure" : "failures"} ·{" "}
          {formatDateTime(group.latestFinishedAt)}
        </span>
        <p className="w-full truncate text-xs text-zinc-500 dark:text-zinc-400">
          {group.message}
        </p>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {group.events.map((event) => (
          <li
            key={event.buildkiteJobId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-5"
          >
            <a
              href={event.jobUrl}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate text-blue-600 hover:underline dark:text-blue-400"
            >
              {event.jobName}
            </a>
            <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400">
              {event.state}
            </span>
            {event.softFailed && (
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                soft failed
              </span>
            )}
            <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {event.durationSeconds}s
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-3">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatDateTime(event.finishedAt)}
              </span>
              <NotificationBadge state={event.notificationState} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Fast Failure Events are immutable observations, so this view reports them and
 * their Slack notification state only. It deliberately exposes no resolution,
 * acknowledgement, or suppression controls.
 */
export function FastCIAlerts({ groups }: { groups: FastFailureGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
        No Fast CI failures were recorded in this window.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <GroupCard key={group.key} group={group} />
      ))}
    </div>
  );
}
