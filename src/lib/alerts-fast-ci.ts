/**
 * Presentation logic for the Fast CI view of the alerts tab.
 *
 * Fast Failure Events are immutable observations with no resolution lifecycle,
 * so nothing here derives an active/resolved status. The only per-event state
 * is how far its Slack notification got.
 */

import {
  notificationStateFor,
  type NotificationState,
  type NotificationStatus,
} from "./alerts-shared";

/** One Fast Failure Event as the alerts API returns it. */
export interface FastFailureEvent {
  buildkiteJobId: string;
  jobName: string;
  jobUrl: string;
  state: string;
  softFailed: boolean;
  durationSeconds: number;
  finishedAt: string;
  buildUrl: string;
  message: string;
  commitSha: string;
  branch: string;
  author: string;
  prNumber: string | null;
  pipeline: string;
  notificationStatuses: NotificationStatus[];
}

export interface FastFailureEventView extends FastFailureEvent {
  notificationState: NotificationState;
}

/** The events one build produced for one commit. */
export interface FastFailureGroup {
  key: string;
  buildUrl: string;
  commitSha: string;
  branch: string;
  author: string;
  message: string;
  pipeline: string;
  prNumber: string | null;
  latestFinishedAt: string;
  events: FastFailureEventView[];
}

/**
 * Cluster events by the build that ran them and the commit they tested, so a
 * single broken build reads as one cluster of symptoms rather than a run of
 * unrelated job failures. Retries produce a distinct build for the same commit
 * and stay separate, because they are separate evidence.
 */
export function groupFastFailureEvents(
  events: readonly FastFailureEvent[],
): FastFailureGroup[] {
  const groups = new Map<string, FastFailureGroup>();

  for (const event of events) {
    const key = `${event.buildUrl}|${event.commitSha}`;
    const view: FastFailureEventView = {
      ...event,
      notificationState: notificationStateFor(event.notificationStatuses),
    };
    const group = groups.get(key);
    if (group) {
      group.events.push(view);
      continue;
    }
    groups.set(key, {
      key,
      buildUrl: event.buildUrl,
      commitSha: event.commitSha,
      branch: event.branch,
      author: event.author,
      message: event.message,
      pipeline: event.pipeline,
      prNumber: event.prNumber,
      latestFinishedAt: event.finishedAt,
      events: [view],
    });
  }

  for (const group of groups.values()) {
    group.events.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
    group.latestFinishedAt = group.events[0].finishedAt;
  }

  return [...groups.values()].sort((a, b) =>
    b.latestFinishedAt.localeCompare(a.latestFinishedAt),
  );
}
