# Contributing

Issues and pull requests are welcome. Before submitting a change:

1. Do not commit `.env`, credentials, transcripts, logs, generated reports, or
   files from `.ai/` and `workspace/`.
2. Install with `npm ci`.
3. Run `npm run check` and `npm audit`.
4. For protocol or process-lifecycle changes, run the relevant stability
   scenarios documented in `bench/README.md`.
5. Update `docs/PROTOCOL.md` when the browser/server contract changes.

Keep the project build-free on the frontend and preserve unknown Claude CLI
events rather than rejecting them. Security changes should include a focused
regression test.
