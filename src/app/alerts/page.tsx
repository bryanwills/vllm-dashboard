"use client";

import type { ReactNode } from "react";
import useSWR from "swr";
import { FastCIAlerts } from "@/components/fast-ci-alerts";
import { FullCIAlerts } from "@/components/full-ci-alerts";
import {
  groupFastFailureEvents,
  type FastFailureEvent,
} from "@/lib/alerts-fast-ci";
import {
  viewFullCiComparisons,
  type FullCiComparison,
} from "@/lib/alerts-full-ci";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FullCIAlertsResponse {
  comparisons?: FullCiComparison[];
  error?: string;
}

interface FastCIAlertsResponse {
  events?: FastFailureEvent[];
  windowDays?: number;
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
          Failed to load {title} alerts.
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function FullCISection() {
  const { data, isLoading, error } = useSWR<FullCIAlertsResponse>(
    "/api/alerts/full-ci",
    fetcher,
    { refreshInterval: 5 * 60 * 1000 },
  );

  return (
    <AlertSection
      title="Full CI"
      description="Each scheduled Full CI run compared with the run before it. New and
        recurring failure conditions are listed apart from the ones a comparison
        saw pass again, and every condition is shown against the two runs it was
        classified from."
      isLoading={isLoading}
      failed={Boolean(error || data?.error)}
    >
      <FullCIAlerts
        comparisons={viewFullCiComparisons(data?.comparisons ?? [])}
      />
    </AlertSection>
  );
}

function FastCISection() {
  const { data, isLoading, error } = useSWR<FastCIAlertsResponse>(
    "/api/alerts/fast-ci",
    fetcher,
    { refreshInterval: 5 * 60 * 1000 },
  );

  return (
    <AlertSection
      title="Fast CI"
      description={`Fast CI jobs that finished in a failure state within 30 seconds, over the last ${data?.windowDays ?? 7} days, grouped by the build and commit they came from. These are observations with no resolution lifecycle; each one shows how far its Slack notification got.`}
      isLoading={isLoading}
      failed={Boolean(error || data?.error)}
    >
      <FastCIAlerts groups={groupFastFailureEvents(data?.events ?? [])} />
    </AlertSection>
  );
}

export default function AlertsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
      <FullCISection />
      <FastCISection />
    </div>
  );
}
