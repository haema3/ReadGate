# Project Agent Guidelines

## Scope

These instructions apply to the entire repository. Build for this platform split:

- **Daytona** provides isolated development, test, CI, and agent-execution sandboxes.
- **Nosana** runs containerized GPU/AI workloads and exposes their deployment endpoints.

Do not assume a language, framework, cloud region, GPU model, or deployment strategy unless the repository or user specifies it. Prefer the smallest supported stack and the official SDK for the selected language.

## Architecture

- Keep application/domain code independent of provider SDKs.
- Put Daytona and Nosana calls behind small provider-specific modules. Do not create a generic cloud abstraction unless two real implementations need it.
- Treat containers as the contract between development and deployment: the same pinned image must run locally or in Daytona and as a Nosana job.
- Keep durable state outside ephemeral sandboxes and GPU jobs.
- Expose health/readiness endpoints for long-running services. Handle termination signals and make jobs restartable and idempotent.

## Configuration And Secrets

- Read configuration from environment variables and validate required values at startup with actionable errors.
- Use these names unless existing project conventions override them:
  - `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET`
  - `NOSANA_API_KEY`
- Commit a `.env.example` containing names and safe placeholders only. Ignore `.env` and generated credential files.
- Never hardcode, print, return to clients, bake into images, or commit API keys, tokens, wallet material, account IDs, or private endpoints.
- Pass secrets through Daytona secrets/environment injection and Nosana vault or secret facilities.
- Use least-privilege credentials and redact authorization headers and secret-bearing payloads from logs.

## Daytona

- Use an official Daytona SDK when code must create or control sandboxes; use the CLI only for operator scripts and documented manual commands.
- Default to an ephemeral sandbox with a finite wall-clock TTL for tests, CI, and one-shot agent work. Preserve a sandbox or create a snapshot only when reuse is required.
- Pin image tags or digests. Do not use floating tags such as `latest`, `lts`, or `stable`.
- Request the minimum CPU, memory, disk, and GPU resources required. Configure the target region only when latency, residency, or user requirements justify it.
- Ensure cleanup with `finally`, `defer`, context managers, or the language equivalent. Wait for deletion when a test depends on cleanup.
- Account for Daytona's inactivity lifecycle: background work alone may not prevent auto-stop. Set an explicit interval for long-running work and retain a finite TTL.
- Use snapshots for reproducible base environments and volumes only for data intentionally shared across sandboxes.

## Nosana

- Package GPU workloads as OCI-compatible container images. Pin the runtime/CUDA base and dependencies, run as a non-root user when supported, and keep images as small as practical.
- Store job definitions as versioned JSON in `deploy/nosana/` when Nosana deployment is part of the task. A definition must explicitly describe images, commands, environment variables, resources, services, and health checks that the workload needs.
- Validate a job definition against the current Nosana schema before submitting it. Select a GPU market from current availability and measured workload requirements; do not assume a GPU model.
- Prefer the official `@nosana/kit` client in TypeScript. For other languages, use the documented HTTPS API at `https://api.nosana.com` rather than wrapping shell commands.
- Check credits and market capacity before deployment. Use bounded waits, retries with backoff for transient failures, and clear timeout errors.
- Stream or preserve deployment/job identifiers and logs needed for diagnosis. Stop failed or obsolete jobs so they do not continue consuming credits.
- Put sensitive values in a Nosana vault or secret facility, never directly in a committed job definition.

## Generated Project Requirements

When creating or extending the project, include only artifacts required by the requested feature. For an end-to-end deployable service, normally provide:

- deterministic dependency and runtime version files;
- a multi-stage `Dockerfile` with a health check and `.dockerignore`;
- `.env.example` and secret-safe configuration validation;
- focused unit tests plus one container smoke test;
- a Daytona-based integration path;
- a validated Nosana job definition for GPU workloads;
- concise README commands for local/Daytona validation, Nosana deployment, status/log inspection, and cleanup.

Do not add Kubernetes, Terraform, a workflow engine, or a custom deployment framework unless the user requests it or the existing repository already uses it.

## Workflow

1. Inspect existing code, manifests, lockfiles, and conventions before choosing tools.
2. State assumptions when platform details are missing. Ask before choices that affect cost, data residency, or destructive actions.
3. Implement and test application behavior locally first.
4. Build the pinned container and run its smoke test in Daytona.
5. Validate the Nosana job definition, deploy, wait for readiness, and verify the workload endpoint.
6. Verify health, then clean up temporary Daytona sandboxes and obsolete Nosana jobs.

## Quality Gates

- Run the repository formatter, linter, type checker, tests, and container smoke test before finishing.
- Mock provider APIs in unit tests. Keep live integration tests opt-in and skip them with a clear reason when credentials are absent.
- Test timeout, retry, authentication failure, cleanup, idempotency, and partial deployment failure paths for provider integrations.
- Log provider, operation, resource identifier, status, duration, and correlation/request ID when available, but never secret values.
- Update README and `.env.example` whenever setup, deployment, or configuration changes.

## Sources Of Truth

Provider APIs evolve. Before generating provider-specific code or manifests, verify names and schemas against the current official documentation instead of relying on memory:

- Daytona: <https://www.daytona.io/docs/>
- Nosana: <https://learn.nosana.com/>

Pin SDK versions in the project lockfile. When a pinned SDK and current documentation differ, follow the pinned SDK's API or upgrade it explicitly with tests.