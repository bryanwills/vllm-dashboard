"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { FastCIAlerts } from "@/components/fast-ci-alerts";
import { MainCIAlerts } from "@/components/main-ci-alerts";
import {
  groupFastFailureEvents,
  type FastFailureEvent,
} from "@/lib/alerts-fast-ci";
import {
  viewMainCiJobAlerts,
  type MainCiJobAlert,
} from "@/lib/alerts-main-ci";
import {
  ALERT_TIME_WINDOWS,
  alertWindowCutoff,
  isAlertTimeWindow,
  withinAlertWindow,
  type AlertTimeWindow,
} from "@/lib/alerts-shared";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type AlertTab = "main-ci" | "fast-ci";

const ALERT_TABS: readonly { value: AlertTab; label: string }[] = [
  { value: "main-ci", label: "Failures" },
  { value: "fast-ci", label: "Fast failures (<30s)" },
];

function isAlertTab(value: string | null): value is AlertTab {
  return ALERT_TABS.some((tab) => tab.value === value);
}

/**
 * The job-category hides are view options, not data filters: they only remove
 * matching job names from the rendered list, and they ride in the URL like the
 * other alert controls.
 */
type HideOption = "softfail" | "optional" | "amd";

const HIDE_OPTIONS: readonly { value: HideOption; label: string }[] = [
  { value: "softfail", label: "Hide soft-fail jobs" },
  { value: "optional", label: "Hide optional jobs" },
  { value: "amd", label: "Hide AMD jobs" },
];

interface AlertOptions {
  showSoftFailed: boolean;
  hide: ReadonlySet<HideOption>;
}

function ToggleSwitch({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={`dashboard-control inline-flex items-center gap-2 text-xs font-semibold ${
        checked
          ? "text-zinc-950 dark:text-zinc-50"
          : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-150 ${
          checked
            ? "border-zinc-950 bg-zinc-950 dark:border-zinc-50 dark:bg-zinc-50"
            : "border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800"
        }`}
      >
        <span
          className={`h-3.5 w-3.5 rounded-full bg-white transition-transform duration-150 motion-reduce:transition-none ${
            checked ? "translate-x-4 dark:bg-zinc-950" : "translate-x-0 dark:bg-zinc-400"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

interface FastCIAlertsResponse {
  events?: FastFailureEvent[];
  windowDays?: number;
  error?: string;
}

interface MainCIAlertsResponse {
  alerts?: MainCiJobAlert[];
  schemaStatus?: "ready" | "pending";
  error?: string;
}

/**
 * One alert source's section: its heading, what the source means, and either
 * its alerts, a loading placeholder, or a failure to load them.
 */
function AlertSection({
  title,
  description,
  isLoading,
  failed,
  children,
}: {
  title: string;
  description: ReactNode;
  isLoading: boolean;
  failed: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      </div>

      {isLoading ? (
        <div
          className="space-y-3 motion-reduce:[&_*]:animate-none"
          aria-label={`Loading ${title} alerts`}
          aria-busy="true"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-4 sm:px-5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 h-3 max-w-xl animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          ))}
        </div>
      ) : failed ? (
        <div className="flex h-48 items-center justify-center text-sm text-red-500">
          Failed to load {title}.
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function MainCISection({
  timeWindow,
  options,
}: {
  timeWindow: AlertTimeWindow;
  options: AlertOptions;
}) {
  const { data, isLoading, error, mutate } = useSWR<MainCIAlertsResponse>(
    "/api/alerts/main-ci",
    fetcher,
    { refreshInterval: 5 * 60 * 1000 },
  );

  const alerts = useMemo(
    () =>
      viewMainCiJobAlerts(
        data?.alerts ?? [],
        alertWindowCutoff(timeWindow),
      ),
    [data, timeWindow],
  );

  const resolveAlert = async (alertId: string) => {
    const response = await fetch("/api/alerts/main-ci/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: Number(alertId) }),
    });
    if (!response.ok) {
      throw new Error(`Resolve failed with ${response.status}`);
    }
    await mutate();
  };

  return (
    <AlertSection
      title="Failures"
      description="Hard command-job failures on the main branch. A failure stays open across builds until that exact Buildkite step positively passes again; soft failures, missing jobs, and older builds finishing late do not resolve it. Resolving an alert by hand closes it without waiting for a pass."
      isLoading={isLoading}
      failed={Boolean(error || data?.error)}
    >
      {data?.schemaStatus === "pending" ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-amber-300 px-6 text-center text-sm text-amber-700 dark:border-amber-800 dark:text-amber-300">
          Backend rollout pending. Migrations 0014/0016 and the Main CI workers
          must be deployed before this preview can show alerts.
        </div>
      ) : (
        <MainCIAlerts
          alerts={alerts}
          onResolve={resolveAlert}
          hideSoftFail={options.hide.has("softfail")}
          hideOptional={options.hide.has("optional")}
          hideAmd={options.hide.has("amd")}
        />
      )}
    </AlertSection>
  );
}

function FastCISection({
  timeWindow,
  showSoftFailed,
}: {
  timeWindow: AlertTimeWindow;
  showSoftFailed: boolean;
}) {
  const { data, isLoading, error } = useSWR<FastCIAlertsResponse>(
    "/api/alerts/fast-ci",
    fetcher,
    { refreshInterval: 5 * 60 * 1000 },
  );

  const groups = useMemo(() => {
    const cutoff = alertWindowCutoff(timeWindow);
    return groupFastFailureEvents(
      (data?.events ?? []).filter(
        (event) =>
          withinAlertWindow(event.finishedAt, cutoff) &&
          (showSoftFailed || !event.softFailed),
      ),
    );
  }, [data, timeWindow, showSoftFailed]);

  return (
    <AlertSection
      title="Fast failures (<30s)"
      description={`Fast CI jobs that finished in a failure state within 30 seconds, over the last ${data?.windowDays ?? 7} days, grouped by the build and commit they came from. These are observations with no resolution lifecycle; each one shows how far its Slack notification got.`}
      isLoading={isLoading}
      failed={Boolean(error || data?.error)}
    >
      <FastCIAlerts groups={groups} showSoftFailed={showSoftFailed} />
    </AlertSection>
  );
}

export default function AlertsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const tab: AlertTab = isAlertTab(tabParam) ? tabParam : "fast-ci";
  const windowParam = searchParams.get("window");
  const timeWindow: AlertTimeWindow = isAlertTimeWindow(windowParam)
    ? windowParam
    : "7d";
  const options: AlertOptions = {
    showSoftFailed: searchParams.get("soft") === "show",
    hide: new Set(
      (searchParams.get("hide") ?? "")
        .split(",")
        .filter((value): value is HideOption =>
          HIDE_OPTIONS.some((option) => option.value === value),
        ),
    ),
  };

  const navigate = (
    nextTab: AlertTab,
    nextWindow: AlertTimeWindow,
    nextOptions: AlertOptions,
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    params.set("window", nextWindow);
    if (nextOptions.showSoftFailed) {
      params.set("soft", "show");
    } else {
      params.delete("soft");
    }
    if (nextOptions.hide.size > 0) {
      params.set(
        "hide",
        HIDE_OPTIONS.filter((option) => nextOptions.hide.has(option.value))
          .map((option) => option.value)
          .join(","),
      );
    } else {
      params.delete("hide");
    }
    router.replace(`/alerts?${params.toString()}`);
  };

  const toggleHide = (option: HideOption) => {
    const hide = new Set(options.hide);
    if (hide.has(option)) {
      hide.delete(option);
    } else {
      hide.add(option);
    }
    navigate(tab, timeWindow, { ...options, hide });
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>

      <div
        role="tablist"
        aria-label="Alert sources"
        className="flex gap-6 border-b border-zinc-200 dark:border-zinc-800"
      >
        {ALERT_TABS.map((item) => {
          const active = item.value === tab;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => navigate(item.value, timeWindow, options)}
              className={`dashboard-control -mb-px inline-flex min-h-11 items-center border-b-2 text-sm font-semibold sm:min-h-10 ${
                active
                  ? "border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Time window"
          className="flex flex-wrap items-center gap-2"
        >
          {ALERT_TIME_WINDOWS.map((item) => {
            const active = item.value === timeWindow;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => navigate(tab, item.value, options)}
                className={`dashboard-control rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "border-zinc-950 bg-zinc-950 text-zinc-50 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                    : "border-zinc-300 text-zinc-500 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-50"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {tab === "fast-ci" && (
          <ToggleSwitch
            checked={options.showSoftFailed}
            onToggle={() =>
              navigate(tab, timeWindow, {
                ...options,
                showSoftFailed: !options.showSoftFailed,
              })
            }
            label="Show soft failed"
          />
        )}
        {tab === "main-ci" &&
          HIDE_OPTIONS.map((option) => (
            <ToggleSwitch
              key={option.value}
              checked={options.hide.has(option.value)}
              onToggle={() => toggleHide(option.value)}
              label={option.label}
            />
          ))}
      </div>

      {tab === "main-ci" ? (
        <MainCISection timeWindow={timeWindow} options={options} />
      ) : (
        <FastCISection
          timeWindow={timeWindow}
          showSoftFailed={options.showSoftFailed}
        />
      )}
    </div>
  );
}
