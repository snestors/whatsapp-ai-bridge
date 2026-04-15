# WhatsApp AI Bridge 🤖

> Connect any AI CLI (Claude Code, Gemini CLI, OpenAI, OpenCode...) to WhatsApp. Send a message → AI responds. That simple.

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20raspberry%20pi-orange)

## What is this?

A bridge that connects **WhatsApp** to any **AI CLI tool**. Your phone becomes a natural language interface to any AI agent you configure — running 24/7 on your own hardware.

```
You (WhatsApp) → Bridge → AI CLI → Bridge → You (WhatsApp)
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
| 🎬 Home Media Server | Add movies/series to Radarr/Sonarr via WhatsApp |
| 📅 Personal Assistant | Read Gmail, manage Google Calendar |
| 🏠 Home Automation | Control services, check system status |
| 📊 Health Tracking | Log meals, workouts, weight |
| 🌐 Research Agent | Web search, summarize articles |
| ⚙️ DevOps | Monitor servers, restart services, check logs |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Your Server / Pi                  │
│                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐  │
│  │ WhatsApp │◄──►│   Bridge     │◄──►│  AI CLI   │  │
│  │  Web.js  │    │  (Node.js)   │    │  (any)    │  │
│  └──────────┘    └──────┬───────┘    └───────────┘  │
│                         │                            │
│                  ┌──────▼───────┐                   │
│                  │  SQLite DB   │                   │
│                  │ (messages)   │                   │
│                  └──────────────┘                   │
└─────────────────────────────────────────────────────┘
```

## Quick Start

### Requirements
- Node.js 18+
- A WhatsApp account (will be used as bot)
- An AI CLI installed (Claude Code, Gemini CLI, etc.)

### Installation

```bash
git clone https://github.com/YOUR_USER/whatsapp-ai-bridge
cd whatsapp-ai-bridge
npm install
cp config.example.json config.json
# Edit config.json with your settings
```

### Configuration

```json
{
  "authorized_numbers": ["1234567890"],
  "ai_cli": {
    "command": "claude",
    "args": ["--dangerously-skip-permissions", "-p"],
    "model_flag": "--model",
    "default_model": "claude-sonnet-4-5"
  },
  "api_port": 3457,
  "qr_port": 3456
}
```

### Run

```bash
# Start the bridge
npm run bridge

# Scan the QR code with WhatsApp (the bot account)
# Open http://localhost:3456 to see the QR

# The bridge is now listening for WhatsApp messages
```

### Run as a Service (Linux/systemd)

```bash
sudo cp scripts/whatsapp-bridge.service /etc/systemd/system/
sudo systemctl enable --now whatsapp-bridge
```

## System Prompt

The AI behavior is configured via `system-prompt.md`. This is where you define what the AI can do, what tools it has access to, and how it should respond.

See [`docs/examples/`](docs/examples/) for ready-to-use system prompts:

- [`home-media.md`](docs/examples/home-media.md) — Sonarr + Radarr + Emby agent
- [`personal-assistant.md`](docs/examples/personal-assistant.md) — Google Workspace agent
- [`devops.md`](docs/examples/devops.md) — Server monitoring agent
- [`general.md`](docs/examples/general.md) — General purpose assistant

## Integrations

### 🎬 Home Media (Sonarr/Radarr/Emby)
See [`integrations/home-media/`](integrations/home-media/)

### 📅 Google Workspace (Gmail/Calendar)
See [`integrations/google-workspace/`](integrations/google-workspace/)

### 🏠 System Monitoring
See [`integrations/system/`](integrations/system/)

## MCP Tools Included

The bridge exposes these tools to the AI via MCP:

| Tool | Description |
|------|-------------|
| `send_message` | Send WhatsApp message to user |
| `get_messages` | Get recent messages |
| `check_new_messages` | Check for new unread messages |
| `get_status` | Bridge connection status |
| `mark_read` | Mark messages as read |

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

## Watchdog (Auto-restart)

```bash
# Keeps the bridge alive 24/7
cp scripts/watchdog.sh /usr/local/bin/
sudo cp scripts/watchdog.service /etc/systemd/system/
sudo systemctl enable --now watchdog
```

## Security

- **Whitelist only**: Only phone numbers in `authorized_numbers` can interact with the AI
- **Local only**: The bridge runs on your own hardware, messages never go through third-party servers (except WhatsApp's own infrastructure)
- **No data collection**: Messages are stored locally in SQLite only

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — use it, modify it, ship it.
