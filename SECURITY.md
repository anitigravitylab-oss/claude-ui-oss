# Security policy

Claude UI intentionally gives an authenticated browser user shell-equivalent
access through the locally installed Claude Code CLI. It is a single-user,
self-hosted tool and is not designed to be exposed directly to the public
internet.

## Supported versions

Security fixes are made on the latest `main` branch. Older revisions are not
supported.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting / Security Advisory flow
for this repository. Do not include credentials, access tokens, private
transcripts, or exploit details in a public issue.

Include the affected revision, deployment topology, reproduction steps, and
impact when possible. Maintainers will acknowledge a valid report as soon as
practical and coordinate disclosure after a fix is available.

## Deployment boundary

- Keep the default loopback bind or place the service behind a private network
  such as Tailscale and an HTTPS reverse proxy.
- Use a unique token generated with `openssl rand -hex 32`.
- Do not reuse the token for another service or put it in issue reports.
- Treat anyone holding the token as having the same practical authority as the
  OS user running Claude UI.
- Keep Node.js, Claude Code, the container base image, and npm dependencies up
  to date.
