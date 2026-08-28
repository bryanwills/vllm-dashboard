"use client";

import useSWR from "swr";
import { FastCIAlerts } from "@/components/fast-ci-alerts";
import {
  groupFastFailureEvents,
  type FastFailureEvent,
} from "@/lib/alerts-fast-ci";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FastCIAlertsResponse {
  events?: FastFailureEvent[];
  windowDays?: number;
  error?: string;
}

export default function AlertsPage() {
  const { data, isLoading, error } = useSWR<FastCIAlertsResponse>(
    "/api/alerts/fast-ci",
    fetcher,
    { refreshInterval: 5 * 60 * 1000 },
  );

  const groups = groupFastFailureEvents(data?.events ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fast CI jobs that finished in a failure state within 30 seconds, over
          the last {data?.windowDays ?? 7} days, grouped by the build and commit
          they came from. These are observations with no resolution lifecycle;
          each one shows how far its Slack notification got.
        </p>
      </div>

      {isLoading && (
        <div
          className="space-y-3 motion-reduce:[&_*]:animate-none"
          aria-label="Loading Fast CI alerts"
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
      )}

      {(error || data?.error) && (
        <div className="flex h-48 items-center justify-center text-sm text-red-500">
          Failed to load Fast CI alerts.
        </div>
      )}

      {!isLoading && !error && !data?.error && (
        <FastCIAlerts groups={groups} />
      )}
    </div>
  );
}
