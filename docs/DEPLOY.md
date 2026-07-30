# claude-ui セルフホスト / デプロイガイド

自分の無料 Linux VM に、自分の Claude ログインで claude-ui を立てるための手順です。
Docker / bare-metal(systemd) の両方、および HTTPS 公開・セキュリティの注意をまとめています。

---

## 0. ⚠️ 最初に読む — このツールの性質

claude-ui は **ブラウザから Claude Code を操作する単一ユーザー用ツール**です。次を理解した上で使ってください。

- **ブラウザからシェル同等の操作ができます。** ターミナルタブは本物の PTY で、チャットタブも Bash などのツールを実行できます。URL とトークンを知っている人は、ホスト上でコマンドを実行できるのと同じです。
- **1 つの Claude アカウントで動きます。** 認証はホストの `~/.claude` を使う「共有アカウント」方式です。アクセスできる全員があなたの Claude セッション・使用量・権限を共有します。**マルチテナントな公開 SaaS ではありません。**
- **公開インターネットに直接晒さないでください。** 必ずトークンを設定し、Tailscale や localhost、あるいはリバースプロキシ + 認証の内側でのみ公開してください。
- **認証情報はイメージに焼きません。** Docker イメージに Claude の資格情報は一切含まれません。ログインは実行時に、あなた自身が行います。

---

## 1. Docker クイックスタート（推奨）

前提: Docker Engine + Docker Compose plugin が入っていること（後述の各章に導入手順あり）。

```bash
# 1) 取得
git clone https://github.com/<your-account>/claude-ui.git
cd claude-ui

# 2) トークンを設定
cp .env.example .env
# .env を編集して CLAUDE_UI_TOKEN を長いランダム文字列にする:
#   openssl rand -hex 32
$EDITOR .env

# 3) 非 root コンテナ (uid 1000) が書き込める作業ディレクトリを作成してビルド
mkdir -p workspace
sudo chown 1000:1000 workspace
docker compose build

# 4) 初回だけ、対話ログイン（Claude アカウントで認証）
#    これで claude-auth ボリューム(/home/node/.claude)にログインが保存される
docker compose run --rm claude-ui claude
#    → 画面の指示に従ってログイン。完了したら /exit または Ctrl-C で抜ける
#    （うまくいかない場合は `docker compose run --rm claude-ui claude /login`）

# 5) 起動
docker compose up -d

# 6) アクセス URL とトークンを確認
docker compose logs | grep listening
#    例: claude-ui listening: http://0.0.0.0:7681/#token=xxxx
#    ブラウザでは 127.0.0.1:7681（または後段のプロキシ/tailnet の URL）を開く
#    #token= には .env で設定したトークンを使う
```

停止・更新:

```bash
docker compose down                 # 停止（claude-auth ボリュームは残る=ログイン保持）
git pull && docker compose build && docker compose up -d   # 更新
```

`claude` 自体のアップデートはイメージ再ビルドで入ります（`docker compose build --no-cache` で最新を強制取得）。

---

## 2. 認証の仕組み

- ログイン状態は Claude が `~/.claude` 以下に保存します。Docker では非 root の `node` ユーザーで実行し、名前付きボリューム **`claude-auth` を `/home/node/.claude` にマウント**して永続化します（`docker-compose.yml` 参照）。
- `claude` バイナリ本体は `~/.local`（ボリュームの外）に入るため、ボリュームマウントで隠れることはありません。
- **イメージには資格情報を焼きません。** 初回の `docker compose run --rm claude-ui claude` による対話ログインで、あなたのアカウント情報が `claude-auth` ボリュームに書き込まれます。
- ログインが期限切れになったら、同じコマンドで再ログインするだけです:
  ```bash
  docker compose run --rm claude-ui claude
  ```
- claude-ui のサーバー自身は認証情報を一切扱いません。子プロセスの `claude` が普段どおりの認証を使います。

---

## 3. Oracle Cloud「Always Free」VM への導入

Oracle Cloud の Always Free 枠（Ampere A1 / VM.Standard.E2.1.Micro など）は無料で常時稼働でき、claude-ui のセルフホストに向いています。

1. **VM を作成**
   - Oracle Cloud コンソール → Compute → Instances → Create。
   - Image は Ubuntu 22.04/24.04 を推奨。Shape は Always Free 対象のもの。
   - SSH 公開鍵を登録。
   - ネットワーク: **7681 を公開しない**。SSH(22) だけ開け、claude-ui は Tailscale か SSH ポートフォワード越しに使う（後述）。
2. **SSH 接続**
   ```bash
   ssh ubuntu@<vm-public-ip>
   ```
3. **Docker 導入**
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo systemctl enable --now docker
   sudo usermod -aG docker "$USER" && newgrp docker   # sudo なしで docker を使う場合
   ```
4. **取得・設定・起動**
   ```bash
   git clone https://github.com/<your-account>/claude-ui.git
   cd claude-ui
   cp .env.example .env && $EDITOR .env       # CLAUDE_UI_TOKEN を設定
   docker compose build
   docker compose run --rm claude-ui claude    # 初回ログイン
   docker compose up -d
   ```
5. **公開は Tailscale か Caddy 経由で**（次章）。7681 をセキュリティリスト/ファイアウォールで直接開けないこと。

> `deploy/cloud-init.yaml` に、VM 作成時の初期プロビジョニング例（Docker 導入 + clone）があります。トークン設定とログインは起動後に手動で行う前提です。

---

## 4. Docker を使わない bare-metal + systemd

Docker を使わず、VM 上で直接動かす構成です（このリポジトリの標準構成と同等）。

1. **Node.js 22 を導入**（nvm か nodesource）:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs build-essential python3 git
   ```
   `build-essential` と `python3` は node-pty のネイティブビルドに必要です。
2. **Claude Code を導入**（公式インストーラー、ネイティブバイナリ）:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   # ~/.local/bin にインストールされる。PATH を通す:
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
   claude --version
   claude       # 初回ログイン（このユーザーの ~/.claude に保存）
   ```
3. **取得・依存導入**:
   ```bash
   git clone https://github.com/<your-account>/claude-ui.git
   cd claude-ui
   npm ci --omit=dev        # node-pty がここでビルドされる
   ```
4. **systemd unit の例** — `/etc/systemd/system/claude-ui.service`:
   ```ini
   [Unit]
   Description=claude-ui (Claude Code web GUI)
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   # claude にログイン済みのユーザーで動かす
   User=<your-user>
   Environment=HOME=/home/<your-user>
   # トークンを固定（長いランダム文字列に置き換える）
   Environment=CLAUDE_UI_TOKEN=change-me-to-a-long-random-string
   Environment=PATH=/home/<your-user>/.local/bin:/usr/local/bin:/usr/bin:/bin
   WorkingDirectory=/home/<your-user>/claude-ui
   # 既定で 127.0.0.1 バインド。公開は前段プロキシ/Tailscale で
   ExecStart=/usr/bin/node server/index.mjs --host 127.0.0.1 --port 7681
   Restart=on-failure
   RestartSec=3

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now claude-ui
   sudo systemctl status claude-ui
   journalctl -u claude-ui -f          # 起動ログ（listening URL / token）
   ```

---

## 5. HTTPS 公開

`7681` を直接インターネットに公開しないこと。以下のどちらかを推奨します。

### 5a. Tailscale Serve（最も簡単・tailnet 内のみ）

```bash
# VM に Tailscale を導入・ログイン
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 127.0.0.1:7681 を tailnet 内に HTTPS で公開
tailscale serve --bg 7681
tailscale serve status
```

- アクセス: `https://<your-host>.ts.net/#token=<トークン>`（tailnet に参加している自分のデバイスからのみ到達可能）。
- Docker 構成でも同じ（`docker-compose.yml` の既定バインド `127.0.0.1:7681` にそのまま向ける）。

### 5b. Caddy リバースプロキシ（独自ドメイン + Let's Encrypt 自動 TLS）

`/etc/caddy/Caddyfile`:

```caddy
claude.<your-domain>.example {
    reverse_proxy 127.0.0.1:7681
    # 追加の保護として Basic 認証を重ねると良い（任意）:
    # basic_auth {
    #     <user> <bcrypt-hash>
    # }
}
```

```bash
sudo systemctl reload caddy
```

- DNS の A/AAAA レコードを VM の IP に向け、80/443 のみ開放。7681 はローカルのまま。
- claude-ui のトークン認証に加えて、プロキシ側でも認証を重ねるとより安全です。

---

## 6. セキュリティチェックリスト

- [ ] `CLAUDE_UI_TOKEN` を長いランダム文字列で設定した（`.env` / systemd `Environment`）。既定のランダム自動生成トークンに依存しない。
- [ ] サーバーを `0.0.0.0` で**直接**インターネットに公開していない。既定の `127.0.0.1` バインド + Tailscale / リバースプロキシ経由にしている。
- [ ] クラウドのファイアウォール/セキュリティリストで 7681 を開けていない（22/443 のみ等）。
- [ ] このツールは**ターミナル = ホスト上のシェル**であり、URL+トークンを知る全員がホストでコマンド実行できる、という前提を共有相手全員が理解している。
- [ ] 認証情報をイメージ・リポジトリ・`.env` の Git 追跡対象に含めていない（`.env` は `.gitignore` 済み、`.env.example` のみ追跡）。
- [ ] 可能なら前段プロキシで追加認証（Basic 認証 / SSO）を重ねている。
- [ ] 信頼できないネットワークからは Tailscale などの private network 経由でのみアクセスする。

---

関連ドキュメント: プロトコル詳細は [PROTOCOL.md](PROTOCOL.md)、機能とアーキテクチャは [../README.md](../README.md) を参照。
