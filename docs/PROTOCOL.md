# Claude UI プロトコル仕様

サーバー⇄ブラウザ間の API 契約と、ラップしている `claude` CLI の stream-json プロトコルのリファレンス（Claude Code v2.1.206 時点で実機確認済み）。

設計原則: `claude` CLI のアップデートだけで新機能に追従できること（内部実装への依存禁止）。

## Architecture
- Runtime: Node.js 22 (node-pty のため。Bun は使わない)
- Server: Hono (@hono/node-server) + ws + node-pty
- Frontend: 静的ファイル (public/)、ビルドステップなし、vanilla JS + xterm.js (ローカルにvendor)
- 外部インターフェースは `claude` バイナリのみ:
  - チャットモード: `claude --input-format stream-json --output-format stream-json --verbose [--include-partial-messages]`
  - ターミナルモード: node-pty で `claude` をそのまま起動 (全機能保証・バージョン非依存)
  - 履歴: `~/.claude/projects/<encoded-cwd>/*.jsonl` の読み取り (ベストエフォート、パース失敗は無視)

## Directory layout
```
claude-ui/
  package.json
  server/
    index.mjs        # entry: HTTP + WS server, auth
    chat-session.mjs # claude subprocess (stream-json) management
    pty-session.mjs  # node-pty terminal sessions
    history.mjs      # ~/.claude/projects JSONL reader
    session-watch.mjs # Phase 5b: passive JSONL tail ("watch") for cross-tab live sync
    fs-api.mjs       # directory listing for cwd picker
    push.mjs         # Web Push (VAPID keys + subscriptions, ~/.claude-ui/push.json)
  public/
    index.html
    app.js / app.css
    manifest.webmanifest / sw.js / icons/ (Phase 3 PWA)
    vendor/ (xterm.js etc.)
  README.md
```

## API contract (server ⇄ browser)
### REST (all require `Authorization: Bearer <token>`)
- GET /api/info → { claudeVersion, cwd, models: [...], permissionModes: [...] }
- GET /api/projects → [{ dir, cwd, sessionCount, lastActivity }] known project dirs from ~/.claude/projects
  (`lastActivity` = newest session file mtime in ms epoch, for "最近使ったパス" sort; best-effort, `null` if unknown)
- GET /api/sessions?cwd=<abs> → [{ sessionId, mtime, firstPrompt, messageCount }]
  (`messageCount` is a lightweight estimate from a head+tail scan of the JSONL, not a full parse — see history.mjs)
- GET /api/sessions/:id/transcript?cwd= → simplified transcript events
- GET /api/sessions/recent?limit=<n, default 8, clamp 1..50> → [{ sessionId, cwd, mtime, firstPrompt, messageCount }]
  (Phase 5b: cross-project "最近のセッション" for the sidebar top section — every project's sessions merged and
  sorted by mtime desc. Built from listProjects+listSessions, same bounded-concurrency scans, no new read path.)
- GET /api/fs?path=<abs> → { dirs: [...], files: [...] } (cwd picker fallback browser)

Phase 3 — Web Push (self-hosted VAPID, all still under `/api/*` so the same token middleware guards them):
- GET /api/push/public-key → { publicKey } (VAPID public key, for `PushManager.subscribe({applicationServerKey})`)
- POST /api/push/subscribe → body = `PushSubscription.toJSON()` (`{endpoint, keys:{p256dh,auth}}`); dedupes by `endpoint`
- POST /api/push/unsubscribe → body `{endpoint}`
- Storage: `~/.claude-ui/push.json` (VAPID keypair + subscriptions), dir mode 0700 / file mode 0600, generated on first use. Never in the repo.
- Send triggers (server/chat-session.mjs, fire-and-forget via server/push.mjs `sendPush()`): `result` event (completion, short excerpt of the first prompt only — never the full message), `control_request`/`can_use_tool` (tool name only), and an abnormal `exit`/process `error` seen before any `result` (disconnect). 404/410 responses from the push service auto-delete that subscription.

Phase 2 note: pinned cwd paths (★) are client-only state in `localStorage["claude-ui-pinned-paths"]`
(JSON array of absolute paths, insertion order). No server endpoint or state for pins — the picker
combines this with the `/api/projects` list purely in the browser.

Phase 5a note: whole-workspace restore is client-only state in `localStorage["claude-ui-workspace"]`
— `{cwd, activeIndex, tabs:[{kind:"chat", cwd, attachId, sessionId} | {kind:"terminal", cwd}]}` —
kept fresh on every tab open/close/switch and cwd change (`persistWorkspaceState()` in app.js). On
boot, `tryRestoreWorkspaceOnBoot()` recreates every tab (chat tabs probe `attach` then fall back to
`--resume`, same as a single tab always did; terminal tabs just open a fresh PTY at the same cwd —
a PTY itself is never resumable, server-side terminal behavior is unchanged), restores the active
tab, and restores the sidebar's selected cwd. Superset of the older single-chat pointer
(`localStorage["claude-ui-last-chat-attach"]` + `localStorage["claude-ui-attach:<viewId>"]`), which
is kept as a fallback. **Root-cause fix**: `/api/info`'s `cwd` field is the *server process's* home
directory (a constant), not "what the user last had selected" — `loadInfo()` used to let it win over
the saved `localStorage["claude-ui-cwd"]` on every load (since it's always truthy), which is why a
reload used to always snap the sidebar back to the server's home dir. Fixed by preferring the saved
cwd; `/api/info`'s `cwd` is now only a first-run fallback.

### WS /ws/chat
HTTP Upgrade の `Sec-WebSocket-Protocol` に
`claude-ui.auth.<UTF-8 token の unpadded base64url>` を指定する。認証情報を URL・アクセスログへ残さない。
ブラウザが `Origin` を送る場合は `Host` と同一であることも必須（明示的な追加許可は
`CLAUDE_UI_ALLOWED_ORIGINS` のカンマ区切り）。
- client→server:
  - {type:"start", cwd, model?, permissionMode?, effort?, resume?, forkSession?}
    - `effort`: "low"|"medium"|"high"|"max" (実プロセスでプローブ済み。CLI起動時に `--effort <effort>` としてそのまま渡す)
  - {type:"user_message", text}  (スラッシュコマンド文字列、例 "/compact" もこの経路で送れる)
  - {type:"permission_response", requestId, behavior:"allow"|"deny", updatedInput?, updatedPermissions?, message?}
  - {type:"interrupt"}
  - {type:"control", subtype, requestId?, payload?}  ← 汎用 control_request 中継 (Phase 1)
    - サーバーは `subtype` をハードコード列挙せず、`request_id`（クライアント指定 or 採番）と `{...payload, subtype}` をそのまま CLI stdin へ `control_request` として転送する
    - 主な subtype: `set_model` {model}, `set_permission_mode` {mode}, `apply_flag_settings` {settings:{effortLevel}}（`settings` オブジェクトでラップが必須。フラットな `effortLevel` はエラーになる — 実機確認済み）, `get_context_usage` {}, `get_settings` {}
    - 対応する `control_response` は既存の passthrough（下記 cli_event）経由でクライアントに届く。クライアントは `event.response.request_id` で自分の送った `requestId` と突き合わせる
  - {type:"stop"}  (kill subprocess)
  - {type:"attach", attachId}  ← Phase 4: 既存セッションへの再接続（下記参照）
  - {type:"watch", sessionId, cwd}  ← Phase 5b: JSONL 追尾のみ開始（`claude` は起動しない。下記参照）。
    最初のメッセージとしてのみ有効（`attach`/`start` と同じ扱い）
- server→client:
  - {type:"cli_event", event: <raw stream-json event>}   ← passthrough原則。UIが解釈（control_response もここに乗る）
  - {type:"permission_request", requestId, toolName, input, suggestions?}
  - {type:"session_started", sessionId}  (initイベントから抽出)
  - {type:"exit", code}
  - {type:"error", message}
  - {type:"attached", attachId}  ← Phase 4: `start` 直後、spawn 成功時に1回だけ送る
  - {type:"attach_failed"}  ← Phase 4: 対応する attachId が無い（TTL失効・サーバー再起動等）。送信後サーバー側でこの ws を close する
  - {type:"attach_complete", generating}  ← Phase 4: attach のバッファ replay 完了直後。`generating` でスピナー状態を復元させる
  - {type:"watch_started", sessionId}  ← Phase 5b: 追尾開始（クライアントはここで「閲覧モード」表示を出す）
  - {type:"watch_denied", reason}  ← Phase 5b: `sessionId`/`cwd` が不正、または watcher 数上限超過。送信後 ws を close する
  - {type:"transcript_append", line: <JSONL row>}  ← Phase 5b: 追尾中に追記された1行（user/assistantのみ。resultはJSONLに存在しない）。
    `line` は REST transcript の行や cli_event の `event` と同じ形（`uuid` 込み）— クライアントは既存の
    `handleCliEvent(line)` にそのまま渡し、既存の uuid dedup + 描画パスを再利用する（新しい描画コードは無い）

### Phase 4: デタッチ / 再アタッチ（チャットのみ、ターミナルは対象外）
WS が切れても `claude` 子プロセスは kill しない。`server/session-registry.mjs` が `attachId`(crypto UUID)
→ { child, ws, state, buffer, generating, idleTimer } のレジストリを保持し、`server/chat-session.mjs` が
stream-json 側のプロトコル知識を持つ。
- 新規セッション開始時、spawn 成功直後に `{type:"attached", attachId}` を送る。
- WS が閉じると "detached" になる。生成中なら result まで完走させ、権威イベント（cli_event の
  system/user/assistant/result, および permission_request/session_started/exit/error の各トップレベル型）
  のみバッファする。再アタッチ後は権威イベントからトランスクリプトを再構築する（既存の resume 描画ロジックを流用）。
- Phase 5a（進行中ターンの partial 復元）: `stream_event`（partial delta）は上の権威バッファとは別に、
  進行中ターン専用の非破壊バッファ（`session-registry.mjs` の `partialBuffer`、上限 `PARTIAL_BUFFER_LIMIT`=2000件
  /`PARTIAL_BUFFER_BYTE_LIMIT`=2MB、超過時はFIFOで先頭を捨てる）に常時ミラーされる。新しいターン開始
  （`user_message` 受信）とターン完了（`result` 受信）でリセット（空配列に）される — 「生成中に限り、そのターン
  の頭から」だけを保持する設計。attach 時は 権威バッファ replay → **partial バッファ replay（drain せず読むだけ、
  複数回の attach/detach をまたいでも同じターンの頭から再現できる）** → `attach_complete` の順で送る。ワイヤ上の
  新しいメッセージ型は無い（既存の `{type:"cli_event", event:{type:"stream_event",...}}` がそのまま増えるだけ）。
  クライアントは既存の `handleStreamEvent`（message_start → content_block_start/delta）にそのまま流し込むだけで
  書きかけの本文 + ステータスが復元される（新しい描画パスは追加していない）。権威イベントで完了済みのターンは
  partialBuffer が既に空なので replay 対象がなく、二重描画にはならない。
- リロード復元時の二重描画防止: `/api/sessions/:id/transcript` の各行に CLI の per-event `uuid` を含める。
  JSONL 行とライブ stream-json イベントは同一 uuid を持つ（実機確認済み）ため、クライアントは REST で
  描画済みの uuid を記録し、attach replay で同一 uuid の cli_event をスキップする（完全一致 dedup）。
- クライアントは新しい WS の最初のメッセージとして `{type:"attach", attachId}` を送ることで再接続する。
  見つかれば: バッファを順に replay → `{type:"attach_complete", generating}` → 以後ライブ中継。
  二重接続時は新しい ws が勝つ（古い ws は server 側で close）。
  見つからなければ: `{type:"attach_failed"}` を送って ws を close（クライアントは既存の `--resume`
  フロー、つまり `{type:"start", resume:sessionId}` の新規接続にフォールバックする）。
- アイドル TTL: detached かつ非生成状態が続くと（デフォルト30分、`CLAUDE_UI_DETACH_TTL_MS` で上書き可）、
  子プロセスを SIGTERM（既存のエスカレーション付き killChild を流用）し、レジストリから削除する。
  レジストリのエントリが存在する ⇔ 子プロセスが生きている、という不変条件を維持するため、削除は常に
  子プロセスの `exit` ハンドラの中で行う。
- サーバー終了時（SIGTERM/SIGINT）は登録済みの全セッションを（生成中/detached問わず）bounded-time で
  kill してから終了する — detach 機能によって「サーバーを落としてもオーファンな `claude` プロセスが残る」
  ことがないようにするため。

### Phase 5b: セッション観測（watch, チャットのみ・ターミナルは対象外）
GUI のターミナルタブで動かしているセッション（`claude --resume <id>` の生の TUI、chat-session.mjs
の管理下にない）の進捗を、同じセッションを resume 表示しているチャットタブへ自動反映するための機構。
Phase 4 のデタッチ/再アタッチとは独立（`server/session-registry.mjs` には一切触れない — watcher は
セッションではない）。
- クライアント: 自分の子プロセスを持たない（= `started`/`attachId` がどちらも無い）状態でセッションを
  resume 表示したチャットタブは、新しい ws を張って最初のメッセージとして `{type:"watch", sessionId, cwd}`
  を送る（`openResumedChat` → `ensureWatching()`、`.ai/current-task.md` 参照）。
- サーバー: `server/session-watch.mjs` が `(cwd, sessionId)` を `history.mjs` の
  `resolveTranscriptPath`（REST transcript と同一の allowlist + ルート配下チェック）で検証し、対象
  JSONL を `fs.watch` + 2秒ポーリングのフォールバック併用で追尾する。追記されたバイトだけを読み、
  行単位でパースして `type:"user"|"assistant"` の行のみ（JSONLに存在する唯一のメッセージ型 —
  `result`/`system` は永続化されない）を `{type:"transcript_append", line}` として転送する。
  開始オフセットは watch 開始時点のファイルサイズ（クライアントは並行して REST transcript を
  読んでいるため、以降の追記だけを転送すれば足りる）。
- 上限: プロセス全体で同時 watcher 数 20（`MAX_WATCHERS`）。超過時・不正な `(cwd, sessionId)` は
  `{type:"watch_denied"}` を送って ws を close する。
- 解除: ws close で watcher（fs.watch ハンドル + ポーリング interval）を即座に破棄（FDリークなし）。
- クライアント側の描画: `transcript_append` の `line` は REST transcript の行 / cli_event の `event`
  と同一形（`uuid` 込み）なので、既存の `handleCliEvent(line)` にそのまま渡すだけで良い —
  Phase 4 の uuid dedup・レンダリングパスをそのまま再利用し、新しい描画コードは追加していない。
- 送信時の遷移: watch 中のタブでメッセージを送信すると、`stopWatching()` が watch 用 ws を閉じてから
  既存の `start`（`resume: sessionId` 付き）で新しい ws を張り直す — 「新しい `claude --resume` 子
  プロセスを起動する」という既存の（Phase 5b 以前からの）挙動をそのまま踏襲する。送信ボタンは watch
  中も常に有効（生成中フラグによる無効化はしない — 分岐が単純だったため「送信は常に可能」を採用）。
- 表示: watch 中は「このセッションは他の場所で実行中です（閲覧モード）」を composer 上部に表示する
  （`watch_started` 受信時のみ表示 — `watch_denied` では出さない）。

### control_request 実機確認メモ（v2.1.207）
- `get_context_usage` の応答は `{totalTokens, maxTokens, autoCompactThreshold, isAutoCompactEnabled, percentage, model, categories:[...], ...}`。
  `autoCompactThreshold` は UI 側の従来計算式 `ctx - min(maxOutput,20000) - 13000` と実測値ベースで一致する（200000トークンcontextで167000）ため、
  円形ゲージの残り% は `(autoCompactThreshold - totalTokens) / autoCompactThreshold * 100` で計算し、クライアント側フォールバック概算と同じ式を共有する。
- `apply_flag_settings` は `{subtype:"apply_flag_settings", settings:{effortLevel:"low"|"medium"|"high"|"max"}}` の形で送る（`settings` 必須、直下に `effortLevel` を置くとエラー）。`effortLevel:"max"` は実プロセスで起動時 `--effort max` / セッション途中 `apply_flag_settings` の両方で受理されることを確認済み（アカウント/プラン依存の可能性はあるため、拒否された環境ではUIから外すこと）。
- `set_model` / `set_permission_mode` の control_response は `{subtype:"success", request_id}` のみ（変更後の値のエコーは無い）。UI側は自分が送った値を楽観的に反映する。

### WS /ws/terminal?cwd=&cols=&rows=  (+ optional &resume=<sessionId>)
認証 subprotocol は `/ws/chat` と同じ。
- client→server: binary/string = keystrokes, {type:"resize",cols,rows} as JSON text frame prefixed protocol (use JSON frames: {type:"input",data}, {type:"resize",...})
- server→client: {type:"output", data}, {type:"exit", code}

## 確定プロトコル仕様（調査済み・v2.1.206）
- チャットモード起動コマンド:
  `claude --print --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio [--model X] [--permission-mode M] [--resume ID] [--fork-session] --add-dir ...`
  cwd は spawn の cwd で指定。
- stdin user メッセージ: `{"type":"user","message":{"role":"user","content":"..."},"parent_tool_use_id":null}` (1行1JSON)
- 権限リクエスト (stdout): `{"type":"control_request","request_id":"<uuid>","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{...},"tool_use_id":"...","permission_suggestions":[...],"description":"..."}}`
- 権限応答 (stdin):
  allow: `{"type":"control_response","response":{"subtype":"success","request_id":"<uuid>","response":{"behavior":"allow","updatedInput":{...元input...}}}}`
  deny:  `{"type":"control_response","response":{"subtype":"success","request_id":"<uuid>","response":{"behavior":"deny","message":"User denied"}}}`
- interrupt (stdin): `{"type":"control_request","request_id":"<uuid>","request":{"subtype":"interrupt"}}`
- set_permission_mode / set_model も同形式の control_request で送れる (subtype + mode/model フィールド)
- 出力イベント type: system(init/compact_boundary/status), assistant, user, result, stream_event, control_request, control_response, keep_alive, rate_limit_event ほか。**未知typeは落とさずUIにraw転送**
- init イベントに session_id, model, tools[], slash_commands[], claude_code_version が入る → UIで利用
- permission-mode の値: acceptEdits|auto|bypassPermissions|manual|dontAsk|plan (+未指定=default)
- 履歴: `~/.claude/projects/<cwdの非英数字を全て'-'に置換>/*.jsonl`。行typeは user/assistant/summary/last-prompt 等。sessionId はトップレベルフィールド。
- stream-json 入力でスラッシュコマンド文字列も送信可能

## PWA (Phase 3)
- `public/manifest.webmanifest` + `public/sw.js`, registered from `app.js` (`registerServiceWorker()`), unauthenticated static files like everything else in `public/`
- Service worker caches the app shell only (`APP_SHELL` list in sw.js), cache name is `claude-ui-shell-<CACHE_VERSION>`; bump `CACHE_VERSION` on any shell-file change — `activate` deletes every non-matching `claude-ui-shell-*` cache
- `/api/*` and `/ws/*` are always network-only in the fetch handler (never cached, never intercepted for non-GET)
- Push events: if any window is `focused` (`clients.matchAll` + `client.focused`), the notification is suppressed. `notificationclick` focuses an existing same-origin window or opens one

## Security
- 起動時にランダムトークン生成 (env CLAUDE_UI_TOKEN で固定可)、コンソールにURL表示
- デフォルト bind 127.0.0.1、--host 0.0.0.0 オプションあり
- トークンなしアクセスは 401
- REST 本文は 64 KiB、WebSocket frame は 1 MiB、同時 WS は 100 接続まで
- CSP、clickjacking 防止、MIME sniffing 防止、Referrer Policy を全 HTTP 応答に付与

## Update-proofing rules (絶対)
- claude の内部ファイル・undocumented API を import しない
- stream-json イベントは未知の type/subtype が来ても落ちない (unknown はそのまま raw 表示)
- CLI フラグは起動時に `claude --help` の出力で存在確認してから使う (optional flags)
- ターミナルモードは常に利用可能なフォールバック
