#!/bin/bash
# Send a WhatsApp message via the bridge API
# Usage: ./notify.sh <phone_number> "Your message"
# Example: ./notify.sh 1234567890 "Download complete!"

PHONE="${1}"
MESSAGE="${2}"
API_PORT="${API_PORT:-3457}"

if [ -z "$PHONE" ] || [ -z "$MESSAGE" ]; then
    echo "Usage: $0 <phone> <message>"
    exit 1
fi

curl -s -X POST "http://localhost:${API_PORT}/send" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"${PHONE}\",\"message\":\"${MESSAGE}\"}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('OK' if d.get('success') else 'FAIL: ' + str(d))"
