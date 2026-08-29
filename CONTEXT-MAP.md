# Context Map

## Contexts

- [Alert Production](./alerting/CONTEXT.md): reconciles CI source observations into durable alert history and notification intent.
- [CI Dashboard](./src/CONTEXT.md): presents CI operational state and alert history, and owns queue-wait alerts.

## Relationships

- **Alert Production to CI Dashboard**: Alert Production defines and writes Fast and Full CI alert records. CI Dashboard reads those records, independently owns Queue Wait Alerts, and does not mutate schema during requests.
