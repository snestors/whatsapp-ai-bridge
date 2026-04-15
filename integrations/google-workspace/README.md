# Google Workspace Integration

Adds Gmail and Google Calendar access to your AI agent.

## Setup

### 1. Install workspace-mcp

```bash
pip install uvx  # or: pip install uv
uvx workspace-mcp --version
```

### 2. Create Google OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Gmail API** and **Google Calendar API**
4. Create OAuth 2.0 credentials (Desktop App)
5. Download `client_secret.json`
6. Place it at `~/.google_workspace_mcp/credentials/client_secret.json`

### 3. Authorize your account

```bash
uvx workspace-mcp --single-user --tools gmail calendar --tool-tier core
# Follow the OAuth flow in your browser
# Credentials saved to ~/.google_workspace_mcp/credentials/
```

### 4. Run as a persistent service

This keeps the MCP always available (no reconnection delay):

```bash
sudo cp workspace-mcp.service /etc/systemd/system/
sudo systemctl enable --now workspace-mcp
```

**workspace-mcp.service:**
```ini
[Unit]
Description=Google Workspace MCP Server
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER
Environment=GOOGLE_OAUTH_CLIENT_ID=YOUR_CLIENT_ID
Environment=GOOGLE_OAUTH_CLIENT_SECRET=YOUR_CLIENT_SECRET
Environment=OAUTHLIB_INSECURE_TRANSPORT=1
ExecStart=/home/YOUR_USER/.local/bin/uvx workspace-mcp \
  --transport streamable-http \
  --single-user \
  --tools gmail calendar tasks \
  --tool-tier core
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 5. Add to Claude config

In `~/.claude.json`, add the MCP as HTTP (persistent):

```json
{
  "mcpServers": {
    "google-workspace": {
      "type": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `gcal_list_events` | List upcoming calendar events |
| `gcal_create_event` | Create a new event |
| `gcal_update_event` | Update existing event |
| `gcal_delete_event` | Delete event |
| `search_gmail_messages` | Search emails |
| `get_gmail_message_content` | Read email content |
| `send_gmail_message` | Send email |
| `create_draft` | Create email draft |
