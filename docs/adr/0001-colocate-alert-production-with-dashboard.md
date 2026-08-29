---
status: accepted
---

# Colocate alert production with the dashboard

The Alert Production bounded context, including its worker package, tests, CI workflow, and schema definitions, lives in `vllm-dashboard` rather than `ci-infra`. The worker remains separately deployed, but co-location gives alert schema, producer behavior, and the dashboard read model one maintenance owner; `ci-infra` retains only infrastructure concerns that consume the packaged worker.
