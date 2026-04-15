# Setup Guide

## Requirements

- Linux (Ubuntu, Debian, Raspberry Pi OS, etc.)
- Node.js 18+
- Chromium browser (for WhatsApp Web)
- An AI CLI installed and authenticated

## Step 1 — Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
```

## Step 2 — Install Chromium

```bash
sudo apt install -y chromium-browser
# or on Raspberry Pi:
sudo apt install -y chromium
```

## Step 3 — Clone and install

```bash
git clone https://github.com/YOUR_USER/whatsapp-ai-bridge
cd whatsapp-ai-bridge
npm install
cp config.example.json config.json
```

## Step 4 — Configure

Edit `config.json`:

```json
{
  "authorized_numbers": ["YOUR_PHONE_NUMBER"],
  "ai_cli": {
    "command": "claude",
    "args": ["--dangerously-skip-permissions", "-p"]
  }
}
```

`authorized_numbers` — only these numbers can talk to the AI. Use international format without `+` (e.g., `14155552671`).

## Step 5 — Write your system prompt

Edit `system-prompt.md` to define what your AI agent does.
See [`docs/examples/`](examples/) for inspiration.

## Step 6 — First run & QR scan

```bash
node bridge.cjs
```

Open `http://YOUR_SERVER_IP:3456` in a browser and scan the QR code with a WhatsApp account (this will be the bot account — use a secondary number or a spare SIM).

## Step 7 — Run as a service

```bash
# Edit scripts/whatsapp-bridge.service with your username and path
sudo cp scripts/whatsapp-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-bridge
```

## Step 8 — Test it

Send a WhatsApp message from your authorized number to the bot account. You should get a response from the AI.

## Troubleshooting

**Bridge not responding:**
```bash
systemctl status whatsapp-bridge
journalctl -u whatsapp-bridge -f
```

**QR code expired:**
```bash
systemctl restart whatsapp-bridge
# Scan again at http://YOUR_IP:3456
```

**AI not responding:**
- Check that the AI CLI is installed: `which claude` / `which gemini`
- Check authentication: `claude --version`
- Check logs: `/tmp/bridge.log`

## Raspberry Pi Tips

- Use an external USB drive for data storage (SD cards wear out)
- Set `chromium_path` to `/usr/bin/chromium` in config.json
- Enable `--disable-dev-shm-usage` if Chromium crashes (low RAM)
