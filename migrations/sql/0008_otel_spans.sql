-- Normalized OpenTelemetry spans received from trusted Buildkite jobs.
CREATE TABLE IF NOT EXISTS otel_spans (
    trace_id                  text NOT NULL,
    span_id                   text NOT NULL,
    parent_span_id            text,
    trace_state               text,
    trace_flags               integer NOT NULL DEFAULT 0,
    span_name                 text NOT NULL,
    span_kind                 smallint NOT NULL DEFAULT 0,
    start_time                timestamptz NOT NULL,
    end_time                  timestamptz NOT NULL,
    duration_ms               double precision NOT NULL,
    status_code               smallint NOT NULL DEFAULT 0,
    status_message            text,
    service_name              text,
    scope_name                text,
    scope_version             text,
    resource_schema_url       text,
    scope_schema_url          text,
    organization_slug         text,
    pipeline_slug             text,
    build_id                  text,
    build_number              bigint,
    build_state               text,
    step_id                   text,
    step_key                  text,
    job_id                    text,
    job_label                 text,
    job_state                 text,
    agent_id                  text,
    agent_name                text,
    agent_queue               text,
    resource_attributes       jsonb NOT NULL DEFAULT '{}',
    span_attributes           jsonb NOT NULL DEFAULT '{}',
    span_events               jsonb NOT NULL DEFAULT '[]',
    span_links                jsonb NOT NULL DEFAULT '[]',
    dropped_attributes_count  integer NOT NULL DEFAULT 0,
    dropped_events_count      integer NOT NULL DEFAULT 0,
    dropped_links_count       integer NOT NULL DEFAULT 0,
    received_at               timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS idx_otel_spans_received
    ON otel_spans (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_otel_spans_build
    ON otel_spans (
        organization_slug, pipeline_slug, build_number, start_time
    );

CREATE INDEX IF NOT EXISTS idx_otel_spans_build_id
    ON otel_spans (build_id, start_time)
    WHERE build_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_otel_spans_job
    ON otel_spans (job_id, start_time)
    WHERE job_id IS NOT NULL;
