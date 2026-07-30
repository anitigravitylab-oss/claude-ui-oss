# Claude UI

Claude Code CLI をそのままラップする Web GUI。ブラウザから Claude Code の全機能を使える。

> 非公式のコミュニティプロジェクトであり、Anthropic の製品または公式 UI ではありません。

- **チャットモード** — `claude` の stream-json インターフェースを使ったリッチな GUI。ストリーミング応答、ツール実行の折りたたみカード、thinking 表示、権限確認ダイアログ、セッション再開、モデル / permission mode 切替、スラッシュコマンド補完
- **ターミナルモード** — node-pty + xterm.js で **本物の Claude Code TUI** をブラウザに転送。対話 UI を含む CLI の全機能が定義上 100% 動く
- **セッションブラウザ** — `~/.claude/projects/` の履歴を一覧・再開（チャットでもターミナル `--resume` でも）
- **マルチタブ** — 複数のチャット / ターミナルを同時に開ける
- **トークン認証** — 起動時に生成されるトークンなしでは API / WS にアクセス不可
- **PWA / プッシュ通知** — ホーム画面に追加してアプリのように起動でき、応答完了・権限確認・切断をロック中でも Web Push で受け取れる（クイックアクションシートのトグルで有効化）
- **デタッチ / 再アタッチ**（チャットのみ） — スマホで画面ロック・アプリ切替などで WS が切れても `claude` 子プロセスは kill せず裏で完走し、復帰時に自動で再接続して途中経過ごと復元する

## Quickstart

```bash
npm install
npm start                 # http://127.0.0.1:7681/#token=XXXX が表示される
```

オプション:

```bash
node server/index.mjs --port 7681 --host 0.0.0.0   # LAN/tailnet に公開
CLAUDE_UI_TOKEN="$(openssl rand -hex 32)" node server/index.mjs  # トークン固定
```

表示された URL（`#token=` 付き）をブラウザで開く。fragment は HTTP リクエストやアクセスログには送信されず、トークンは localStorage に保存後 URL から除去される。2 回目以降は素の URL でよい。スマホからも使える（レスポンシブ対応）。

前提: `claude` が PATH にあり、ログイン済みであること（このツール自体は認証情報を一切扱わない。子プロセスの `claude` が普段の認証をそのまま使う）。

## アーキテクチャ / アップデート追従の仕組み

```
ブラウザ (public/ — vanilla JS + xterm.js, ビルドなし)
   │  WebSocket / REST (トークン認証)
   ▼
Node サーバー (server/ — Hono + ws + node-pty)
   │
   ├─ チャット: claude --print --input-format stream-json --output-format stream-json
   │            --verbose --include-partial-messages --permission-prompt-tool stdio
   └─ ターミナル: node-pty で claude をそのまま起動
```

**外部インターフェースは `claude` バイナリだけ。** Claude Code の内部実装・内部ファイルには依存しない。だから Claude Code がアップデートされても、`claude update`（または再インストール）するだけで新機能に追従できる。

追従を壊さないための設計ルール:

1. **stream-json イベントは素通し** — サーバーは既知の type（`control_request` 等）だけ特別扱いし、未知の type/subtype はそのままクライアントに転送する。新イベントが増えても落ちない
2. **ターミナルモードは常に完全** — PTY 転送は Claude Code のバージョンと完全に無関係。新しい対話 UI・スラッシュコマンド・ウィザードはすべてターミナルタブでそのまま動く
3. **履歴読み取りはベストエフォート** — `~/.claude/projects/*.jsonl` のパースは失敗行を無視するだけで、フォーマット変更でエラーにならない
4. **スラッシュコマンド一覧・ツール一覧は CLI 自身から取得** — `system/init` イベントの `slash_commands` / `tools` を UI がそのまま使う。ハードコードしない

## チャットモードのプロトコル

`claude` の公式 stream-json インターフェース（Agent SDK と同じもの）を使用:

- ユーザー入力 → stdin に `{"type":"user","message":{...}}`
- 権限確認 → stdout の `control_request` (subtype: `can_use_tool`) を GUI ダイアログに変換し、Allow / Deny を `control_response` で返す
- 中断 (Esc) → `control_request` (subtype: `interrupt`)
- ストリーミング → `--include-partial-messages` の `stream_event` を逐次描画

permission mode はセッション開始時に選択できる（`default` / `acceptEdits` / `plan` / `bypassPermissions` など。CLI が受け付ける値は `/api/info` 経由で提供）。`default` のときの実際の挙動は `~/.claude/settings.json` の設定に従う — 普段の CLI とまったく同じ。

### デタッチ / 再アタッチ

チャットの WS が切れても（ターミナルは対象外）、生成中なら `claude` プロセスをサーバー側で完走させ、`attachId` で再接続すると
バッファされた権威イベント（system/user/assistant/result 等）に加え、進行中ターンのストリーミング部分差分も
上限付きバッファからリプレイされる。詳細プロトコルは `docs/PROTOCOL.md` の「Phase 4 / Phase 5a」節を参照。

- 何もせず detached のまま既定 30 分でセッションは自動終了する。変更するには:
  ```bash
  CLAUDE_UI_DETACH_TTL_MS=60000 node server/index.mjs   # 例: 1分に短縮
  ```

## セキュリティ

- このツールは **ブラウザからシェル同等の操作ができる** もの。信頼できるネットワーク（localhost / Tailscale 等）でのみ公開すること
- デフォルト bind は `127.0.0.1`。`--host 0.0.0.0` は自己責任で
- API / WebSocket はすべてトークン必須（REST は `Authorization: Bearer`、WebSocket は専用 subprotocol）。`#token=` は初回画面でトークンをブラウザへ渡すためだけに使い、ページ読込直後に URL から除去される。静的ファイルのみ無認証
- HTTPS が必要なら手前にリバースプロキシ（caddy / cloudflared 等）を置く

## セルフホスト / デプロイ

自分の無料 Linux VM（Oracle Cloud Always Free / GCP e2-micro 等）に、**自分の Claude ログインで**立てられます。Docker / bare-metal(systemd) 両対応の手順は **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照。

```bash
cp .env.example .env && $EDITOR .env        # CLAUDE_UI_TOKEN を設定
docker compose build
docker compose run --rm claude-ui claude    # 初回だけ対話ログイン（claude-auth ボリュームに保存）
docker compose up -d                        # 127.0.0.1:7681 で起動
```

> ⚠️ **認証モデル**: これはブラウザからシェル同等の操作ができる**単一ユーザー用**ツールで、1 つの Claude ログインで動きます。公開 SaaS ではありません。コンテナは非 root ユーザーで動き、認証情報はイメージに焼かず実行時ボリュームで渡します。公開インターネットに直接晒さず、Tailscale / リバースプロキシ経由で使ってください。

## Tailscale での運用（例）

systemd + `tailscale serve` で常時稼働・HTTPS 化する構成例:

```bash
systemctl status claude-ui        # サービス本体 (127.0.0.1:7681 で稼働、再起動後も自動起動)
tailscale serve status            # https://<your-host>.ts.net:9443 → 127.0.0.1:7681
```

- アクセス URL: `https://<your-host>.ts.net:9443/#token=<token>`（tailnet 内のみ）
- トークンは `/etc/systemd/system/claude-ui.service` の `CLAUDE_UI_TOKEN` で固定
- systemd でも root を避け、Claude にログイン済みの専用ユーザーでサービスを動かす
- 停止: `systemctl disable --now claude-ui` / serve 解除: `tailscale serve --https=9443 off`

## PWA / プッシュ通知

ホーム画面に追加するとアプリのように起動できる（`manifest.webmanifest` + `sw.js`、アプリシェルのみキャッシュ、`/api` `/ws` は常にネットワーク直結）。iOS は Safari でホーム画面に追加した後のみ Web Push が使える。

クイックアクションシートの「プッシュ通知」トグルで有効化すると、応答完了・権限確認・異常切断をロック画面通知で受け取れる。VAPID 鍵と購読情報はリポジトリではなく `~/.claude-ui/push.json`（パーミッション 600）に保存される。外部プッシュサービスのアカウントは不要（自前 VAPID、`web-push` パッケージ経由でブラウザ標準の push service にのみ送信）。

## REST API

| エンドポイント | 内容 |
|---|---|
| `GET /api/info` | claude バージョン、モデル・permission mode 一覧 |
| `GET /api/projects` | `~/.claude/projects` にある既知プロジェクト一覧 |
| `GET /api/sessions?cwd=` | セッション履歴一覧 |
| `GET /api/sessions/:id/transcript?cwd=` | セッションの簡約トランスクリプト |
| `GET /api/fs?path=` | ディレクトリ一覧（cwd ピッカー用） |
| `GET /api/push/public-key` | VAPID 公開鍵 |
| `POST /api/push/subscribe` | プッシュ購読の登録 |
| `POST /api/push/unsubscribe` | プッシュ購読の解除 |

WebSocket: `/ws/chat`（stream-json 中継）、`/ws/terminal`（PTY 中継）。プロトコル詳細は [docs/PROTOCOL.md](docs/PROTOCOL.md) を参照。

## 開発

```bash
npm run dev            # = node server/index.mjs --port 7681
```

- フロントは `public/` の静的ファイルのみ（ビルドステップなし）。xterm.js / addons / marked / DOMPurify は `public/vendor/` にローカル配置（CDN 依存なし、オフライン動作）
- サーバーは Node 20+ / ESM。直接依存は Hono、ws、node-pty、web-push

```bash
npm ci
npm run check            # unit tests + syntax + vendored asset integrity
npm audit
```

脆弱性の連絡方法は [SECURITY.md](SECURITY.md)、コントリビューション手順は
[CONTRIBUTING.md](CONTRIBUTING.md)、同梱ライブラリのライセンスは
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照。

## ライセンス

[MIT](LICENSE)
