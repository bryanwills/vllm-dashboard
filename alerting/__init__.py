"""Runtime core for the vLLM CI alerting service.

Processes scheduled reconciliation commands idempotently against Postgres as
the system of record, and dispatches Slack notifications from a transactional
outbox. See README.md for the seam layout and which tickets extend it.
"""

from alerting.analyzer import (
    AnalyzerError,
    CauseCategory,
    CheckpointRef,
    ClaudeCodeRunner,
    ComparisonContext,
    CompletedAnalysis,
    FailureCache,
    FailureCondition,
    FailureLifecycle,
    FullCIAnalysisHandler,
    GitHubRestClient,
    PersistedAnalysis,
    PullRequestRef,
    S3CheckpointStore,
    SuspiciousPR,
    pack_checkpoint,
    unpack_checkpoint,
)
from alerting.commands import SCHEMA_VERSION, Command
from alerting.fast_ci import (
    DatabricksFastCISource,
    DatabricksStatementClient,
    FastCIScanHandler,
    FastFailureEvent,
    FastFailureState,
)
from alerting.full_ci import (
    BuildkiteFullCISource,
    BuildkiteRestClient,
    FullCIComparison,
    FullCIJobOutcome,
    FullCIReconciliationHandler,
    FullCIReconciliationState,
    FullCIRun,
)
from alerting.ports import (
    ClaimOutcome,
    DestinationMode,
    ExecutionRecord,
    ExecutionStatus,
    OutboxMessage,
    OutboxRecord,
    OutboxStatus,
    SlackPermanentError,
    SlackTransientError,
)
from alerting.postgres import (
    PostgresAlertStore,
    build_fast_ci_runtime,
    build_full_ci_analysis_runtime,
    build_full_ci_runtime,
)
from alerting.runtime import (
    AlertingRuntime,
    DispatchResult,
    HandlerCompletion,
    ProcessResult,
    ProcessStatus,
    UnknownCommandTypeError,
)
from alerting.slack import SlackDeliveryPort, UrllibHttpTransport

__all__ = [
    "SCHEMA_VERSION",
    "AlertingRuntime",
    "AnalyzerError",
    "CauseCategory",
    "CheckpointRef",
    "ClaimOutcome",
    "ClaudeCodeRunner",
    "Command",
    "BuildkiteFullCISource",
    "BuildkiteRestClient",
    "ComparisonContext",
    "CompletedAnalysis",
    "DatabricksFastCISource",
    "DatabricksStatementClient",
    "DestinationMode",
    "DispatchResult",
    "ExecutionRecord",
    "ExecutionStatus",
    "FailureCache",
    "FailureCondition",
    "FailureLifecycle",
    "FastCIScanHandler",
    "FastFailureEvent",
    "FastFailureState",
    "FullCIAnalysisHandler",
    "FullCIComparison",
    "FullCIJobOutcome",
    "FullCIReconciliationHandler",
    "FullCIReconciliationState",
    "FullCIRun",
    "GitHubRestClient",
    "HandlerCompletion",
    "OutboxMessage",
    "OutboxRecord",
    "OutboxStatus",
    "PersistedAnalysis",
    "PostgresAlertStore",
    "ProcessResult",
    "ProcessStatus",
    "PullRequestRef",
    "S3CheckpointStore",
    "SlackPermanentError",
    "SlackDeliveryPort",
    "SlackTransientError",
    "SuspiciousPR",
    "UrllibHttpTransport",
    "UnknownCommandTypeError",
    "build_fast_ci_runtime",
    "build_full_ci_analysis_runtime",
    "build_full_ci_runtime",
    "pack_checkpoint",
    "unpack_checkpoint",
]
