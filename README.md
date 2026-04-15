# WhatsApp AI Bridge

> Connect any AI CLI (Claude Code, Gemini CLI, OpenAI, OpenCode...) to WhatsApp. Send a message, AI responds. That simple.

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20raspberry%20pi-orange)

## What is this?

A bridge that connects **WhatsApp** to any **AI CLI tool**. Your phone becomes a natural language interface to any AI agent you configure — running 24/7 on your own hardware.

```
You (WhatsApp) → Bridge (Node.js) → AI CLI → Bridge → You (WhatsApp)
```

**Works with:**
- [Claude Code](https://claude.ai/code) (`claude`)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
- [OpenAI CLI](https://github.com/openai/openai-cli) (`openai`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Any CLI tool that reads from stdin / accepts a `-p` prompt flag

## Use Cases

| Scenario | What the AI does |
|----------|-----------------|
| Home Media Server | Add movies/series to Radarr/Sonarr via WhatsApp |
| Personal Assistant | Read Gmail, manage Google Calendar |
| Home Automation | Control services, check system status |
| Health Tracking | Log meals, workouts, weight |
| Research Agent | Web search, summarize articles |
| DevOps | Monitor servers, restart services, check logs |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Your Server / Raspberry Pi                 │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐   │
│  │ WhatsApp │◄──►│   bridge.cjs │◄──►│  AI CLI (claude)  │   │
│  │  Web.js  │    │  (Node.js)   │    │  with MCP tools   │   │
│  └──────────┘    └──────┬───────┘    └───────────────────┘   │
│                         │                                    │
│                  ┌──────▼───────┐                            │
│                  │  SQLite DB   │                            │
│                  │ (messages)   │                            │
│                  └──────────────┘                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Reliability Layer                                   │    │
│  │  • WA Watchdog (3-layer auto-reconnection)           │    │
│  │  • systemd service (auto-restart on crash)           │    │
│  │  • Daily Summary (cross-session context retention)   │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### How it works

1. **bridge.cjs** runs as a systemd service — it connects to WhatsApp via `whatsapp-web.js` + headless Chromium, stores messages in SQLite, and exposes an HTTP API.
2. When an authorized number sends a message, the bridge spawns the configured AI CLI (e.g. `claude -p "..."`) with the system prompt + message.
3. The AI can respond directly (stdout) or via MCP tools (`send_message`, `get_messages`, etc.) exposed by **index.cjs**.
4. Responses are sent back through WhatsApp. Sessions are persisted so the AI retains conversation context.

### Two entry points

| File | Role | When to use |
|------|------|-------------|
| `bridge.cjs` | Full bridge: WhatsApp Web + HTTP API + auto-response via AI CLI | Production — run as systemd service |
| `index.cjs` | Standalone MCP server (Baileys-based) | When your AI CLI manages its own MCP connections |

## WA Watchdog: 3-Layer Auto-Reconnection

The bridge is designed to stay connected 24/7. Three independent layers ensure recovery from any failure:

### Layer 1 — Bridge-level retry (bridge.cjs)

When WhatsApp disconnects, the bridge automatically reconnects after 5 seconds:

```js
// bridge.cjs — on disconnect
waClient.on("disconnected", (reason) => {
  setTimeout(() => waClient.initialize(), 5000);
});
```

On startup, the bridge retries initialization up to 5 times with increasing delays (10s, 20s, 30s, 40s, 50s). If all 5 attempts fail, it exits so systemd can restart the entire process.

### Layer 2 — Watchdog health monitor (scripts/watchdog.sh)

An external script that runs every 60 seconds:

- Checks if `whatsapp-bridge.service` is active via systemd
- Checks if the HTTP API (`/status`) responds within 5 seconds
- If either check fails: restarts the service and warms up the AI session

```bash
# Install watchdog
cp scripts/watchdog.sh /usr/local/bin/
# Create a systemd service for it (or run via cron)
```

### Layer 3 — systemd auto-restart

The systemd unit (`scripts/whatsapp-bridge.service`) has `Restart=always` with `RestartSec=10`, so if the bridge process crashes entirely, systemd brings it back within 10 seconds.

```
Failure → Layer 1 (5s retry) → Layer 2 (60s health check) → Layer 3 (systemd restart)
```

## Daily Summary System

The Daily Summary system maintains AI context across sessions without consuming extra tokens during normal operation.

### How it works

1. Your `system-prompt.md` contains special markers at the end:
   ```markdown
   <!-- DAILY_SUMMARY_START -->
   (automatically updated — do not edit manually)
   <!-- DAILY_SUMMARY_END -->
   ```

2. A cron job runs `daily-cleanup.sh` every night at 4 AM:
   ```bash
   0 4 * * * /path/to/daily-cleanup.sh
   ```

3. The script:
   - Asks the AI to summarize the day's activity (completed tasks, important context, pending items)
   - Replaces the content between the `DAILY_SUMMARY` markers in `system-prompt.md` with the new summary
   - Resets the conversation session so the next interaction starts fresh but with context

4. When the AI starts a new session, it reads `system-prompt.md` including the summary — giving it continuity about what happened yesterday without replaying old messages.

### Why this matters

- No token waste: the summary is a compact paragraph, not a full conversation replay
- Context survives reboots, crashes, and session resets
- The AI knows what tasks were completed, what's pending, and any important decisions

See [`system-prompt.example.md`](system-prompt.example.md) for how to include the markers.

## Quick Start

### Requirements

- Linux (Ubuntu, Debian, Raspberry Pi OS)
- Node.js 18+
- Chromium browser (for WhatsApp Web)
- An AI CLI installed and authenticated (e.g. `claude`)

### Step 1 — Install dependencies

```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Chromium (for WhatsApp Web)
sudo apt install -y chromium-browser   # Ubuntu/Debian
sudo apt install -y chromium           # Raspberry Pi OS
```

### Step 2 — Clone and install

```bash
git clone https://github.com/snestors/whatsapp-ai-bridge.git
cd whatsapp-ai-bridge
npm install
```

### Step 3 — Configure

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "authorized_numbers": ["YOUR_PHONE_NUMBER"],
  "ai_cli": {
    "command": "claude",
    "args": ["--dangerously-skip-permissions", "-p"]
  },
  "auto_respond": true,
  "qr_port": 3456,
  "api_port": 3457
}
```

`authorized_numbers` — only these numbers can talk to the AI. Use international format without `+` (e.g. `14155552671`).

### Step 4 — Write your system prompt

```bash
cp system-prompt.example.md system-prompt.md
# Edit system-prompt.md to define what your AI agent does
```

See [`docs/examples/`](docs/examples/) for ready-to-use system prompts.

### Step 5 — First run and QR scan

```bash
node bridge.cjs
```

Open `http://YOUR_SERVER_IP:3456` in a browser and scan the QR code with the WhatsApp account that will be the bot (use a secondary number or spare SIM).

### Step 6 — Run as a systemd service

```bash
# Edit the service file with your username and path
sudo cp scripts/whatsapp-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-bridge
```

### Step 7 — Test it

Send a WhatsApp message from your authorized number to the bot. You should get a response from the AI.

## WhatsApp Commands

These commands are handled directly by the bridge (no AI involved):

| Command | What it does |
|---------|-------------|
| `/reset` | Kills active AI process, clears session and message queue |
| `/status` | Shows bridge uptime, active session, queue length, current task |

## System Prompt

The AI behavior is configured via `system-prompt.md`. This file is injected as context on the first message of each session.

See [`docs/examples/`](docs/examples/) for ready-to-use prompts:

- [`general.md`](docs/examples/general.md) — General purpose assistant
- [`home-media.md`](docs/examples/home-media.md) — Sonarr + Radarr + Emby agent
- [`personal-assistant.md`](docs/examples/personal-assistant.md) — Google Workspace agent

## MCP Tools

The bridge exposes these tools to the AI via MCP (index.cjs):

| Tool | Description |
|------|-------------|
| `send_message` | Send a WhatsApp message to a phone number |
| `get_messages` | Get recent messages (configurable limit) |
| `get_status` | Check WhatsApp connection status |
| `get_chats` | List recent chats with last message |
| `check_new_messages` | Check for unread messages |
| `mark_read` | Mark specific messages as read |

## HTTP API

The bridge also exposes a local HTTP API (default port 3457):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Connection status |
| `/messages/unread` | GET | List unread messages |
| `/messages/recent?limit=20` | GET | Recent messages |
| `/messages/:id/read` | POST | Mark message as read |
| `/messages/read-all` | POST | Mark all as read |
| `/send` | POST | Send message (`{phone, message}`) |
| `/send-voice` | POST | Send voice note (`{phone, file_path}`) |

## Integrations

### Home Media (Sonarr/Radarr/Emby)
See [`integrations/home-media/`](integrations/home-media/)

### Google Workspace (Gmail/Calendar)
See [`integrations/google-workspace/`](integrations/google-workspace/)

## Switching AI Backends

Change the `ai_cli` section in `config.json`:

**Claude Code:**
```json
"ai_cli": { "command": "claude", "args": ["--dangerously-skip-permissions", "-p"] }
```

**Gemini CLI:**
```json
"ai_cli": { "command": "gemini", "args": ["-p"] }
```

**OpenCode:**
```json
"ai_cli": { "command": "opencode", "args": ["run", "-p"] }
```

## File Structure

```
whatsapp-ai-bridge/
├── bridge.cjs                  # Main bridge: WhatsApp Web + HTTP API + AI auto-response
├── index.cjs                   # Standalone MCP server (Baileys-based)
├── config.example.json         # Configuration template
├── system-prompt.example.md    # System prompt template with Daily Summary markers
├── package.json
├── scripts/
│   ├── whatsapp-bridge.service # systemd unit for the bridge
│   ├── watchdog.sh             # Health monitor (Layer 2 of WA Watchdog)
│   └── notify.sh               # CLI helper to send messages via the API
├── docs/
│   ├── setup.md                # Detailed setup guide
│   └── examples/
│       ├── general.md          # General assistant system prompt
│       ├── home-media.md       # Home media server system prompt
│       └── personal-assistant.md # Google Workspace system prompt
└── integrations/
    ├── google-workspace/       # Gmail + Calendar setup guide
    └── home-media/             # Sonarr/Radarr/Emby setup guide
```

## Security

- **Whitelist only**: Only phone numbers in `authorized_numbers` can interact with the AI
- **Local only**: The bridge runs on your own hardware — messages never go through third-party servers (except WhatsApp's own infrastructure)
- **No data collection**: Messages are stored locally in SQLite only
- **API bound to localhost**: The HTTP API listens on `127.0.0.1` only (not exposed to the network)

## Troubleshooting

**Bridge not responding:**
```bash
systemctl status whatsapp-bridge
journalctl -u whatsapp-bridge -f
```

**QR code expired:**
```bash
sudo systemctl restart whatsapp-bridge
# Scan again at http://YOUR_IP:3456
```

**AI not responding:**
- Check the CLI is installed: `which claude`
- Check authentication: `claude --version`
- Check logs: `journalctl -u whatsapp-bridge -f`

**Raspberry Pi tips:**
- Use an external USB drive for data storage (SD cards wear out)
- Set `chromium_path` to `/usr/bin/chromium` in config.json
- The `--disable-dev-shm-usage` flag is already enabled for low-RAM environments

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — use it, modify it, ship it.
