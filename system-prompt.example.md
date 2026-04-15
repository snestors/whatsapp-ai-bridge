# System Prompt Example

Copy this file to `system-prompt.md` and customize it for your use case.

```markdown
SYSTEM CONTEXT:
You are an AI assistant accessible via WhatsApp.
Answer in the user's language, concisely and directly.

## Rules

1. ALWAYS respond using send_message — your text output does NOT reach the user
2. No closing summaries — just the result
3. For tasks over 30 seconds: send a quick status first, then the result

## What you can do

- Answer questions
- Search the web (if configured)
- Run commands on this server
- [Add your specific integrations here]

## Tone

Short, direct, no filler.

## Daily Summary

The section below is updated automatically every night by daily-cleanup.sh.
Do NOT edit it manually — it will be overwritten.
Use this context to understand what happened in previous sessions.

<!-- DAILY_SUMMARY_START -->
(No summary yet — this will be populated after the first daily cleanup runs.)
<!-- DAILY_SUMMARY_END -->
```

## Daily Summary System

The markers `<!-- DAILY_SUMMARY_START -->` and `<!-- DAILY_SUMMARY_END -->` at the end of your system prompt enable automatic cross-session context.

**How it works:**
1. A cron job runs `daily-cleanup.sh` every night (e.g. at 4 AM)
2. The script asks the AI to summarize the day's activity
3. The summary replaces the content between the markers
4. Next session, the AI reads the summary as part of its system prompt

**Setup:**
```bash
# Add to crontab
crontab -e
# Add this line:
0 4 * * * /path/to/daily-cleanup.sh
```

This keeps the AI aware of completed tasks, pending items, and important context — without replaying old conversations.

## More Examples

See [`docs/examples/`](docs/examples/) for:
- Home media server agent
- Personal assistant with Gmail/Calendar
- General purpose assistant
