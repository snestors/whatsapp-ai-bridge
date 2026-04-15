# Contributing to WhatsApp AI Bridge

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Linux (tested on Ubuntu 22.04 and Raspberry Pi OS Bookworm)
- Node.js 18+
- Chromium browser
- An AI CLI installed (Claude Code, Gemini CLI, etc.)
- A spare WhatsApp number for testing (the bot account)

### Local setup

```bash
git clone https://github.com/snestors/whatsapp-ai-bridge.git
cd whatsapp-ai-bridge
npm install
cp config.example.json config.json
cp system-prompt.example.md system-prompt.md
```

Edit `config.json` with your phone number and preferred AI CLI, then:

```bash
node bridge.cjs
```

Scan the QR at `http://localhost:3456` and send a message from your authorized number.

### Project structure

- `bridge.cjs` — Main bridge process (WhatsApp Web + HTTP API + AI auto-response). This is the production entry point.
- `index.cjs` — Standalone MCP server using Baileys. Used when the AI CLI manages its own MCP connections.
- `scripts/` — systemd units, watchdog, and helper scripts.
- `docs/examples/` — Example system prompts for different use cases.
- `integrations/` — Setup guides for specific integrations (Google Workspace, home media, etc.).

## How to Contribute

### Reporting Issues

- Check [existing issues](https://github.com/snestors/whatsapp-ai-bridge/issues) first
- Include your environment: OS, Node.js version, AI CLI and version
- Include relevant logs from `journalctl -u whatsapp-bridge` or the console output
- For connection issues, specify which reconnection layer failed (bridge retry, watchdog, or systemd)

### Submitting Changes

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b feature/your-feature
   ```

2. Make your changes. Keep commits focused — one logical change per commit.

3. Test your changes:
   - Run the bridge locally and verify messages flow end-to-end
   - Test with at least one AI CLI backend
   - If you changed reconnection logic, test by simulating disconnects

4. Push and open a Pull Request:
   ```bash
   git push origin feature/your-feature
   ```

### What makes a good PR

- **Clear title**: describe what the PR does, not how
- **Small scope**: one feature or fix per PR
- **Tested**: describe how you tested it in the PR description
- **Documented**: update README.md or docs/ if your change affects user-facing behavior

## Guidelines

### Code style

- JavaScript (CommonJS with `.cjs` extension) for bridge code
- Use `const` by default, `let` when reassignment is needed
- Console logs prefixed with `[bridge]`, `[watchdog]`, etc.
- Error handling: catch and log, don't crash the process. The bridge must stay up 24/7.

### Architecture decisions

- **No external databases**: SQLite only. The bridge should work on a Raspberry Pi with no internet-dependent services.
- **AI CLI agnostic**: don't hardcode assumptions about Claude. The bridge should work with any CLI that accepts `-p` prompts.
- **Whitelist-first security**: every new feature must respect the `authorized_numbers` config.
- **Reconnection is critical**: any change to connection handling must preserve or improve the 3-layer watchdog system.

### Adding a new integration

1. Create a directory under `integrations/your-integration/`
2. Add a `README.md` with setup instructions
3. Optionally add an example system prompt in `docs/examples/`
4. Update the main README.md integrations section

### Adding a new MCP tool

1. Add the tool definition in `index.cjs` using `server.tool()`
2. Update the MCP Tools table in README.md
3. Document what the tool does and its parameters

## Questions?

Open an issue or start a discussion on the repo. We're happy to help.
