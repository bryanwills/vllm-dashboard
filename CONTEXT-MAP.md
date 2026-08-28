# Context Map

## Contexts

- [Alert Production](./alerting/CONTEXT.md): reconciles CI source observations into durable alert history and notification intent.
- [CI Dashboard](./src/CONTEXT.md): presents CI operational state and alert history to readers.

## Relationships

- **Alert Production to CI Dashboard**: Alert Production defines and writes alert records. The shared migration module applies schema changes; CI Dashboard reads those records and does not mutate schema during requests.
