# claude-ui stability bench

Repeatable, mostly-automatic stress test for the claude-ui server (`server/index.mjs`).
Answers "under what conditions does this thing error out, disconnect, or leak" —
including deliberately abnormal input — and can be used as a regression gate.

## Usage

```
node bench/stability.mjs                       # spawn a throwaway server, run everything, print a report
node bench/stability.mjs --scenario smoke,leakCheck
node bench/stability.mjs --heavy                # longer idle/output variants, higher timeouts
node bench/stability.mjs --json out.json --html out.html
node bench/stability.mjs --url http://127.0.0.1:7681 --token <tok>   # test an already-running server
```

Also available as `npm run bench` (passes through no args; use the direct `node` invocation
above for flags).

By default the bench:

- picks a **random free port** and a **random token**, spawns
  `node server/index.mjs --port <p> --host 127.0.0.1` with `IS_SANDBOX=1` in its env
  (required when running as root — see repo README), waits for `/api/info` to return 200,
  runs the scenarios, and **always** kills the server (SIGTERM, then SIGKILL after a grace
  period) plus any leftover descendant processes in a `finally`.
- never touches the production instance (default port 7681) or any other running
  claude-ui process — it only ever talks to the server it spawned itself, or, with
  `--url`, to a server you name explicitly (in which case leak/proc metrics are
  skipped since the bench doesn't own that process's PID).
- uses the `haiku` model with short prompts to keep API cost/time minimal. Override
  with `--model`.

## Options

| flag | default | meaning |
|---|---|---|
| `--port` | random free port | port for the spawned server |
| `--host` | `127.0.0.1` | bind host for the spawned server |
| `--token` | random | auth token for the spawned server |
| `--url` | (none) | use an already-running server instead of spawning one |
| `--model` | `haiku` | model used for every LLM turn |
| `--concurrency` | `3` | parallel sessions in `concurrentSessions` |
| `--iterations` | `1` | repeat the whole scenario suite N times |
| `--scenario` | (all) | comma-separated scenario names to run |
| `--timeout` | `60000` (`180000` with `--heavy`) | per-scenario watchdog, ms |
| `--heavy` | off | longer idle/output variants; also loosens the per-scenario timeout |
| `--json <path>` | (none) | write a machine-readable JSON report |
| `--html <path>` | (none) | write a self-contained HTML report (no external URLs/fonts) |

Exit code: `0` if every scenario passed **and** the leak check found no growth beyond
threshold; `1` otherwise. Suitable for CI.

## Scenarios

1. **smoke** — one `start` + one `user_message`, expects `session_started` →
   `assistant` → `result` with the exact requested marker text back.
2. **sequentialTurns** — 3 turns over one connection (one `claude` child process);
   checks no turn errors AND that context is retained (turn 2 recalls a codeword
   given in turn 1 — proves the same child process, not a respawn, handled it).
3. **concurrentSessions** — N parallel `/ws/chat` connections, each with a unique
   marker; asserts each reply contains only its own marker and never another
   session's (detects any request/response cross-talk between concurrently
   running `claude` child processes).
4. **longOutput** — a reply long enough to require several `text_delta`
   stream chunks; checks it isn't truncated and still reaches `result`.
5. **interrupt** — sends `interrupt` mid-generation, then verifies the same
   connection can still complete a normal follow-up turn afterward.
6. **permissionFlow** — `permissionMode: "manual"` + `touch <path>`. Allow →
   file exists; deny → file does not exist. Uses `touch` specifically because
   read-only shell commands (e.g. `echo`) are auto-approved by the CLI's own
   built-in rules and never surface a `permission_request` at all (see
   `.ai/lessons.md`).
7. **reconnect** — abruptly terminates the WS mid-generation (not a graceful
   close), confirms the server is still alive, then confirms a new connection
   can either `--resume` the same claude session or at least start a fresh one
   cleanly (either satisfies "the server didn't get stuck").
8. **malformedInput** — fires invalid JSON, an unknown message `type`, a
   `user_message` sent before any `start`, a double `start` in quick succession,
   and a ~400KB `user_message`, all at one throwaway connection. The pass
   criterion is not any particular response to the bad input — it's that a
   completely fresh `smoke()` still passes against the same server afterward.
9. **rapidFire** — bursts several `user_message`/`interrupt` frames back to back
   with no waiting; same pass criterion as `malformedInput` (fresh smoke after).
10. **idleSurvival** — holds a started session open with no traffic (5s, or 90s
    with `--heavy`), then confirms it still answers — no idle-based teardown of
    the child process.
11. **terminalStability** — connects `/ws/terminal`, checks ANSI output arrives,
    input round-trips (another output event after sending a keystroke), resize
    doesn't break the session, then disconnects and polls `/proc` to confirm the
    pty child (and node-pty's helper process, if any) get reaped promptly.
12. **leakCheck** — compares a `/proc/<serverPid>` snapshot taken right after
    the server became ready (baseline) against one taken after every other
    scenario has run: descendant `claude`/pty process count must return to
    baseline, RSS growth must stay under threshold (default 150MB), open FD
    count growth must stay under threshold (default 60). Scoped to the spawned
    server's own descendant-PID tree (via `/proc/*/stat` ppid chains) so it
    can't be confused by an unrelated claude-ui instance's own `claude`
    children running on the same box. Skipped (reported as pass) when using
    `--url`, since the bench doesn't own that process's PID.

Every scenario has its own watchdog (`--timeout`, default 60s/180s heavy) — a hung
scenario is recorded as a failure and the bench moves on rather than hanging forever.

## Interpreting a failure

- A scenario failing because of a real server-side bug (crash, wrong isolation,
  a leak) is the bench **doing its job** — that's the signal it exists to catch.
  Check the printed error/detail line, or the `--json` output's `errors` array
  for that scenario, for specifics.
- A scenario failing because of bench flakiness (e.g. a timeout that's just too
  tight for the model/network on a given run) should be rare given the generous
  defaults, but re-run with `--scenario <name>` in isolation to check before
  assuming it's a real bug.
