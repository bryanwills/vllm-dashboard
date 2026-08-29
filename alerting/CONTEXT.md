# Alert Production

This context turns scheduled CI observations into durable alert history and notification intent. It exists so source-system or worker outages do not lose alert state.

## Language

**Scheduled Command**:
A reconciliation wake-up identified by command type and target time. It is not itself an alert.
_Avoid_: Job, event, tick record

**Automation Execution**:
The durable attempt history for one Scheduled Command identity.
_Avoid_: Worker run, task

**Full CI Run**:
A scheduled daily or nightly CI build eligible for chronological comparison.
_Avoid_: Build, pipeline run

**Full CI Job Outcome**:
The observed state of one job in a Full CI Run, identified across runs by job name.
_Avoid_: Failure condition, test result

**Full CI Comparison**:
The ordered relationship between one Full CI Run and its preceding scheduled Full CI Run.
_Avoid_: Diff, report

**Full CI Failure Condition**:
One job's classification in a Full CI Comparison: new, recurring, or fixed, with a cause and PR attribution. A fixed condition requires a positively observed pass; a fixing PR is recorded only when verified merged.
_Avoid_: Incident, resolution state

**Analyzer Checkpoint**:
An immutable, versioned S3 object holding the analyzer's memory after one completed analysis. Postgres references it by URI and checksum; unreferenced objects are crash debris.
_Avoid_: Backup, snapshot of the database

**Fast Failure Event**:
An observation that one Fast CI job entered an eligible failure state within 30 seconds. It has no resolution lifecycle.
_Avoid_: Incident, alert lifecycle

**Scan Cursor**:
The latest durable Fast CI scan target used to derive the next overlapping observation window.
_Avoid_: Last event time, checkpoint

**Notification Intent**:
A durable request to deliver one rendered alert message to a destination.
_Avoid_: Slack message, notification attempt
