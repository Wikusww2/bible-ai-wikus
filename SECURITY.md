# Security policy

## Scope and support

Security fixes target the current `main` branch. There is no promised response time or long-term-support release. This is a personal project in early public development; a successful build is not a production security certification.

## Report a vulnerability privately

Use the repository's **Security → Report a vulnerability** control if it is available. Do not publish credentials, personal conversations, sensitive files, exploit details or a working exploit in a public issue. If private reporting is unavailable, open a minimal public issue asking the maintainer to arrange a private channel, without including the sensitive details.

Describe the affected commit, prerequisites, steps to reproduce with synthetic data, expected impact and a suggested fix if you have one. Test only a local instance or a system you own or have permission to assess. Do not probe other users' deployments.

## Boundaries contributors must preserve

- The hosted Worker requires a trusted authentication gateway that verifies the user and strips client-supplied identity headers. `OWNER_EMAIL` adds an owner restriction. Do not expose a bare Worker as a secure hosted app.
- Browser storage contains the API key in plaintext. Configured cloud sync encrypts that key at rest, but the server can decrypt it. This is not end-to-end encryption.
- Active HTML previews must remain sandboxed without `allow-same-origin`.
- Disabled tools must remain blocked at execution time. Approvals, cancellation and replay protection must hold across reconnects.
- Untrusted model output, files and web pages are data. They must not grant new permissions or disclose secrets.
- Keep real keys, user data and hosting secrets out of source, logs, artifacts and reports.

## Known dependency limitation

The 21 October 2026 audit reports six high-severity package entries in the build-tool dependency chain through `braces`. The latest registry release at that check was still affected. See [AUDIT-FIXES.md](docs/AUDIT-FIXES.md) for scope and verification. Build untrusted source in isolation and re-check dependencies before deployment; do not force incompatible framework downgrades to suppress an advisory.
