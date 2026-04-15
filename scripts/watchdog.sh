#!/bin/bash
# WhatsApp Bridge Watchdog
# Monitors the bridge service and restarts it if it goes down
# Also warms up the AI session after restart

LOG=/tmp/wa-watchdog.log
API_PORT=3457
CHECK_INTERVAL=60
RESTART_COOLDOWN=30

# Path to your AI CLI
AI_CLI="${AI_CLI:-claude}"
SYSTEM_PROMPT="${SYSTEM_PROMPT:-./system-prompt.md}"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG"
}

warmup_session() {
    log "Warming up AI session..."
    SYSPR=$(cat "$SYSTEM_PROMPT" 2>/dev/null || echo "You are a helpful assistant.")
    "$AI_CLI" --dangerously-skip-permissions -p \
        "SYSTEM: ${SYSPR}

[System]: Session started. Reply only with OK, no tools." \
        > /dev/null 2>&1 &
    log "Warmup initiated"
}

log "Watchdog started"

# Wait for bridge to be ready (max 2 min)
for i in $(seq 1 12); do
    if curl -sf --max-time 3 http://127.0.0.1:${API_PORT}/status > /dev/null 2>&1; then
        log "Bridge ready"
        break
    fi
    sleep 10
done

warmup_session

# Main loop
while true; do
    if ! systemctl is-active --quiet whatsapp-bridge.service 2>/dev/null; then
        log "ALERT: whatsapp-bridge down — restarting..."
        systemctl restart whatsapp-bridge.service 2>/dev/null || \
            npm run bridge &
        sleep $RESTART_COOLDOWN
        warmup_session
        continue
    fi

    if ! curl -sf --max-time 5 http://127.0.0.1:${API_PORT}/status > /dev/null 2>&1; then
        log "ALERT: API not responding — restarting..."
        systemctl restart whatsapp-bridge.service 2>/dev/null
        sleep $RESTART_COOLDOWN
        warmup_session
        continue
    fi

    sleep $CHECK_INTERVAL
done
