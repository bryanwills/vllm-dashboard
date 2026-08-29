import { NotificationBadge } from "@/components/alert-notification-badge";
import {
  CAUSE_LABELS,
  LIFECYCLE_LABELS,
  type FullCiComparisonView,
  type FullCiFailureCondition,
  type FullCiJobOutcome,
  type FullCiLifecycle,
  type FullCiRun,
  type PullRequestRef,
} from "@/lib/alerts-full-ci";
import { commitUrl, formatAlertDateTime } from "@/lib/alerts-shared";

const LIFECYCLE_CLASSES: Record<FullCiLifecycle, string> = {
  new: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  recurring:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  fixed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

/** An absent job is never a passing job, so it is named rather than blank. */
function outcomeLabel(outcome: FullCiJobOutcome | null): string {
  if (outcome === null) return "did not run";
  return outcome.softFailed ? `${outcome.state} (soft failed)` : outcome.state;
}

function PullRequestLink({
  label,
  pr,
}: {
  label: string;
  pr: PullRequestRef | null;
}) {
  if (pr === null) return null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 hover:underline dark:text-blue-400"
      >
        #{pr.number}
      </a>
      <span className="text-zinc-500 dark:text-zinc-400">{pr.title}</span>
    </span>
  );
}

/** One side of the comparison: which build ran, when, and on what commit. */
function RunSummary({ label, run }: { label: string; run: FullCiRun }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <a
        href={run.buildUrl}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 hover:underline dark:text-blue-400"
      >
        build {run.buildNumber}
      </a>
      <a
        href={commitUrl(run.commitSha)}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-blue-600 hover:underline dark:text-blue-400"
      >
        {run.commitSha.slice(0, 7)}
      </a>
      <span className="text-zinc-500 dark:text-zinc-400">
        {run.state} · {formatAlertDateTime(run.scheduledAt)}
      </span>
    </span>
  );
}

/** The two build numbers a condition's outcomes are read against. */
interface ComparedBuilds {
  previousBuildNumber: number;
  currentBuildNumber: number;
}

function ConditionRow({
  condition,
  builds,
}: {
  condition: FullCiFailureCondition;
  builds: ComparedBuilds;
}) {
  return (
    <li className="px-4 py-2.5 text-sm sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
          {condition.jobName}
        </span>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${LIFECYCLE_CLASSES[condition.lifecycle]}`}
        >
          {LIFECYCLE_LABELS[condition.lifecycle]}
        </span>
        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          {CAUSE_LABELS[condition.cause]}
        </span>
      </div>

      {condition.summary && (
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
          {condition.summary}
        </p>
      )}

      <div className="mt-1 flex flex-col gap-y-0.5 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">
          build {builds.previousBuildNumber}:{" "}
          {outcomeLabel(condition.previousOutcome)} · build{" "}
          {builds.currentBuildNumber}: {outcomeLabel(condition.currentOutcome)}
        </span>
        <PullRequestLink label="Culprit PR" pr={condition.culpritPr} />
        <PullRequestLink label="Fixing PR" pr={condition.fixingPr} />
      </div>
    </li>
  );
}

function ConditionSection({
  title,
  emptyMessage,
  conditions,
  builds,
}: {
  title: string;
  emptyMessage: string;
  conditions: FullCiFailureCondition[];
  builds: ComparedBuilds;
}) {
  return (
    <section>
      <h3 className="border-b border-zinc-100 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-500 sm:px-5 dark:border-zinc-800/60 dark:text-zinc-400">
        {title}
      </h3>
      {conditions.length === 0 ? (
        <p className="px-4 py-2.5 text-xs text-zinc-400 sm:px-5 dark:text-zinc-500">
          {emptyMessage}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {conditions.map((condition) => (
            <ConditionRow
              key={condition.jobName}
              condition={condition}
              builds={builds}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ComparisonCard({ comparison }: { comparison: FullCiComparisonView }) {
  const builds: ComparedBuilds = {
    previousBuildNumber: comparison.previousRun.buildNumber,
    currentBuildNumber: comparison.currentRun.buildNumber,
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-4 py-3 sm:px-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <RunSummary label="Current" run={comparison.currentRun} />
          {comparison.isLatest && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Latest comparison
            </span>
          )}
          <NotificationBadge
            state={comparison.notificationState}
            className="ml-auto"
          />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
          <RunSummary label="Baseline" run={comparison.previousRun} />
          <span className="ml-auto shrink-0 text-zinc-500 dark:text-zinc-400">
            analyzed {formatAlertDateTime(comparison.analyzedAt)}
          </span>
        </div>
        <p className="mt-1 w-full truncate text-xs text-zinc-500 dark:text-zinc-400">
          {comparison.currentRun.message}
        </p>
      </div>

      <ConditionSection
        title={comparison.isLatest ? "Ongoing" : "Ongoing at this comparison"}
        emptyMessage="No new or recurring failure conditions."
        conditions={comparison.ongoing}
        builds={builds}
      />
      <ConditionSection
        title="Fixed in this comparison"
        emptyMessage="No failure conditions were observed passing again."
        conditions={comparison.fixed}
        builds={builds}
      />
    </div>
  );
}

/**
 * Full CI Failure Conditions, newest comparison first, with what is still
 * broken separated from what this comparison observed passing again. Every
 * condition is shown against the two runs it was classified from; the
 * analyzer's raw report, cache, and memory checkpoints are never rendered.
 */
export function FullCIAlerts({
  comparisons,
}: {
  comparisons: FullCiComparisonView[];
}) {
  if (comparisons.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
        No Full CI comparisons have been analyzed yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {comparisons.map((comparison) => (
        <ComparisonCard
          key={comparison.currentRun.buildkiteBuildId}
          comparison={comparison}
        />
      ))}
    </div>
  );
}
