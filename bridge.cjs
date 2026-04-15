#!/usr/bin/env node

/**
 * WhatsApp Bridge Service
 * - Runs whatsapp-web.js + Chromium permanently as a systemd service
 * - Exposes HTTP API for sending/receiving messages
 * - Stores all messages in SQLite
 * - Only processes messages from authorized numbers
 * - QR code web page for initial pairing
 */

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const express = require("express");
const Database = require("better-sqlite3");
const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } = require("fs");
const { resolve } = require("path");
const { spawn, execFileSync } = require("child_process");

// --- Config ---
const CONFIG_PATH = process.env.WA_CONFIG || resolve(__dirname, "config.json");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

const AUTHORIZED = new Set(config.authorized_numbers || []);
const QR_PORT = config.qr_port || 3456;
const API_PORT = config.api_port || 3457;
const CHROMIUM_PATH = config.chromium_path || "/usr/bin/chromium";
const AUTH_PATH = config.auth_path || "./.wwebjs_auth";
const DB_PATH = config.db_path || "./data/messages.db";

// --- Database ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT NOT NULL,
    phone TEXT,
    name TEXT,
    body TEXT,
    timestamp TEXT NOT NULL,
    from_me INTEGER DEFAULT 0,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);
  CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages(jid);
`);

const stmtInsert = db.prepare(
  "INSERT INTO messages (jid, phone, name, body, timestamp, from_me, is_read) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const stmtUnread = db.prepare(
  "SELECT * FROM messages WHERE is_read = 0 AND from_me = 0 ORDER BY id ASC"
);
const stmtMarkRead = db.prepare("UPDATE messages SET is_read = 1 WHERE id = ?");
const stmtMarkAllRead = db.prepare("UPDATE messages SET is_read = 1 WHERE is_read = 0");
const stmtRecent = db.prepare(
  "SELECT * FROM messages ORDER BY id DESC LIMIT ?"
);

function extractPhone(jid) {
  if (!jid) return null;
  // Handle both @c.us and @lid formats
  return jid.split("@")[0];
}

function isAuthorized(jid, resolvedPhone) {
  if (AUTHORIZED.size === 0) return true; // no whitelist = allow all
  for (const num of AUTHORIZED) {
    if (resolvedPhone && resolvedPhone.includes(num)) return true;
    if (jid.includes(num)) return true;
  }
  return false;
}

// --- WhatsApp Client ---
let waClient = null;
let isReady = false;
let currentQR = null;
let jidMap = {}; // maps phone numbers to JIDs for sending

console.log("[bridge] Starting WhatsApp client...");

waClient = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
  puppeteer: {
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
    ],
  },
});

waClient.on("qr", (qr) => {
  currentQR = qr;
  console.log("[bridge] QR code received - scan at http://<ip>:" + QR_PORT);
});

waClient.on("ready", () => {
  isReady = true;
  currentQR = null;
  console.log("[bridge] WhatsApp connected!");
});

waClient.on("authenticated", () => {
  console.log("[bridge] Authenticated.");
});

waClient.on("auth_failure", (msg) => {
  console.error("[bridge] Auth failure:", msg);
});

waClient.on("disconnected", (reason) => {
  isReady = false;
  console.log("[bridge] Disconnected:", reason);
  // Auto-reconnect
  setTimeout(() => {
    console.log("[bridge] Reconnecting...");
    waClient.initialize().catch((e) => console.error("[bridge] Reconnect error:", e.message));
  }, 5000);
});

waClient.on("message", async (msg) => {
  const jid = msg.from;
  const name = msg._data.notifyName || jid;
  const body = msg.body || "";
  const timestamp = new Date(msg.timestamp * 1000).toISOString();

  // Resolve real phone number from contact (handles @lid JIDs)
  let phone = null;
  try {
    const contact = await msg.getContact();
    phone = contact.number || extractPhone(jid);
  } catch {
    phone = extractPhone(jid);
  }

  const authorized = isAuthorized(jid, phone);

  // Store JID mapping
  if (phone) jidMap[phone] = jid;

  // Mark as seen (double blue check)
  try {
    const chat = await msg.getChat();
    await chat.sendSeen();
  } catch {}

  // Handle media (photos, files, audio)
  let mediaDescription = "";
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media) {
        // Clean extension: "ogg; codecs=opus" -> "ogg"
        const rawExt = media.mimetype.split("/")[1] || "bin";
        const ext = rawExt.split(";")[0].trim();
        const filename = `media_${Date.now()}.${ext}`;
        const mediaPath = resolve(__dirname, "media", filename);
        require("fs").mkdirSync(resolve(__dirname, "media"), { recursive: true });
        require("fs").writeFileSync(mediaPath, media.data, "base64");
        mediaDescription = ` [Archivo adjunto: ${media.mimetype}, guardado en ${mediaPath}]`;
        console.log(`[bridge] Media saved: ${mediaPath}`);

        // Auto-transcribe audio messages
        if (media.mimetype.startsWith("audio/")) {
          try {
            const transcription = execFileSync(
              "/usr/local/bin/whisper-transcribe.sh",
              [mediaPath, "es"],
              { timeout: 30000, encoding: "utf-8" }
            ).trim();
            if (transcription && !transcription.startsWith("Error")) {
              mediaDescription = ` [Nota de voz transcrita: "${transcription}"]`;
              console.log(`[bridge] Transcribed audio: ${transcription.substring(0, 80)}`);
            }
          } catch (e) {
            console.error(`[bridge] Transcription failed: ${e.message}`);
          }
        }
      }
    } catch (e) {
      mediaDescription = ` [Archivo adjunto no descargable: ${e.message}]`;
    }
  }

  // Handle quoted message (reply context)
  let quotedContext = "";
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      quotedContext = ` [En respuesta a: "${(quoted.body || "").substring(0, 200)}"]`;
    } catch {}
  }

  // Always store in DB
  const fullBody = body + mediaDescription + quotedContext;
  stmtInsert.run(jid, phone, name, fullBody, timestamp, 0, authorized ? 0 : 1);

  if (authorized) {
    console.log(`[bridge] Message from ${name} (${phone}): ${fullBody.substring(0, 100)}`);

    // Special commands
    const cmd = body.trim().toLowerCase();

    if (cmd === "/reset") {
      // Kill running Claude process if any
      if (currentClaudeProc) {
        try { currentClaudeProc.kill("SIGTERM"); } catch {}
        currentClaudeProc = null;
      }
      activeSession = null;
      usageLimitHit = false;
      processing = false;
      messageQueue.length = 0;
      currentTaskStarted = null;
      currentTaskPrompt = null;
      try { require("fs").unlinkSync(SESSION_FILE); } catch {}
      await waClient.sendMessage(jid, "🔄 Reset completo:\n- Sesión de Claude eliminada\n- Proceso activo terminado\n- Cola de mensajes limpia\n\nEl próximo mensaje inicia conversación nueva.");
      return;
    }

    if (cmd === "/status") {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      let status = `📊 *Bridge Status*\n`;
      status += `• Uptime: ${h}h ${m}m\n`;
      status += `• Sesión activa: ${activeSession ? "sí" : "no"}\n`;
      status += `• Cola de mensajes: ${messageQueue.length} pendientes\n`;
      if (processing && currentTaskStarted) {
        const elapsed = Math.round((Date.now() - currentTaskStarted) / 1000);
        status += `• ⏳ *Procesando* (${elapsed}s):\n  "${(currentTaskPrompt || "").substring(0, 100)}"\n`;
        status += `• PID Claude: ${currentClaudeProc?.pid || "N/A"}`;
      } else {
        status += `• Idle (sin proceso activo)`;
      }
      await waClient.sendMessage(jid, status);
      stmtInsert.run(jid, phone, "me", status, new Date().toISOString(), 1, 1);
      return;
    }

    if (config.auto_respond !== false) {
      handleAutoResponse(msg, jid, phone, name, fullBody);
    }
  } else {
    console.log(`[bridge] Ignored message from unauthorized ${phone} (${jid})`);
  }
});

// --- Auto-response via Claude CLI ---
const SESSION_FILE = resolve(__dirname, ".wa_session_id");
const SYSTEM_PROMPT = resolve(__dirname, "system-prompt.md");
let activeSession = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf-8").trim() : null;
let usageLimitHit = false; // se activa cuando el plan se agota
const messageQueue = [];
let processing = false;
let currentClaudeProc = null;
let currentTaskStarted = null;
let currentTaskPrompt = null;

async function handleAutoResponse(originalMsg, jid, phone, name, body) {
  messageQueue.push({ originalMsg, jid, phone, name, body });
  if (!processing) processQueue();
}

async function processQueue() {
  if (messageQueue.length === 0) { processing = false; return; }
  processing = true;
  const { originalMsg, jid, phone, name, body } = messageQueue.shift();
  // Re-read session file in case watchdog wrote it after startup
  if (!activeSession && existsSync(SESSION_FILE)) {
    activeSession = readFileSync(SESSION_FILE, "utf-8").trim() || null;
    if (activeSession) console.log("[bridge] Session loaded from file:", activeSession.substring(0,8) + "...");
  }

  let chat;
  let typingInterval;
  let typingTimeout;
  const TYPING_MAX_SECONDS = config.typing_timeout || 120; // max 2 min typing
  if (originalMsg) {
    try {
      chat = await originalMsg.getChat();
      await chat.sendStateTyping();
      typingInterval = setInterval(async () => {
        try { await chat.sendStateTyping(); } catch {}
      }, 10000);
      typingTimeout = setTimeout(() => {
        clearInterval(typingInterval);
        typingInterval = null;
        try { chat.clearState(); } catch {}
        console.log("[bridge] Typing timeout reached, still waiting for Claude...");
      }, TYPING_MAX_SECONDS * 1000);
    } catch {}
  }

  try {
    // Build prompt
    let prompt = `[WhatsApp de ${name}]: ${body}`;

    // Build claude args
    const args = ["-p", "--model", "sonnet", "--dangerously-skip-permissions"];
    if (activeSession) {
      args.push("--resume", activeSession);
    } else {
      const sysPrompt = existsSync(SYSTEM_PROMPT) ? readFileSync(SYSTEM_PROMPT, "utf-8") : "";
      if (sysPrompt) {
        prompt = `CONTEXTO DEL SISTEMA:\n${sysPrompt}\n\n---\n\n${prompt}`;
      }
    }
    args.push("--output-format", "json");
    args.push(prompt);

    console.log(`[bridge] Calling Claude (opus)...`);
    currentTaskStarted = Date.now();
    currentTaskPrompt = body;

    // Use spawn for async execution
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("claude", args, {
        cwd: process.env.HOME || process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      currentClaudeProc = proc;

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        currentClaudeProc = null;
        currentTaskStarted = null;
        currentTaskPrompt = null;
        if (code === 0) resolve(stdout);
        else reject(new Error(`Exit ${code}: ${stderr || stdout}`));
      });
      proc.on("error", (err) => {
        currentClaudeProc = null;
        currentTaskStarted = null;
        currentTaskPrompt = null;
        reject(err);
      });
    });

    // Parse response
    let response, sessionId;
    try {
      const parsed = JSON.parse(result);
      response = parsed.result ?? result;
      sessionId = parsed.session_id;

    } catch {
      response = result.trim();
    }

    // Save session ID
    if (sessionId) {
      activeSession = sessionId;
      writeFileSync(SESSION_FILE, sessionId);
    }

    // Stop typing
    if (typingInterval) clearInterval(typingInterval);
    if (typingTimeout) clearTimeout(typingTimeout);
    if (chat) { try { await chat.clearState(); } catch {} }

    // Only send response if Claude didn't already send via MCP
    // (if result is just "OK" or very short, Claude already sent via send_message)
    const alreadySent = !response || response.trim().toLowerCase() === "ok" || response.trim().length < 5;
    if (!alreadySent && response.length > 0) {
      const maxLen = 4000;
      const chunks = [];
      let remaining = response;
      while (remaining.length > 0) {
        if (remaining.length <= maxLen) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf("\n", maxLen);
        if (splitAt < maxLen / 2) splitAt = maxLen;
        chunks.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt).trimStart();
      }

      for (const chunk of chunks) {
        await waClient.sendMessage(jid, chunk);
        if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
      }

      stmtInsert.run(jid, phone, "Claude", response, new Date().toISOString(), 1, 1);
      console.log(`[bridge] Responded (${response.length} chars): ${response.substring(0, 80)}...`);
    } else {
      console.log("[bridge] Claude already sent response via MCP, skipping duplicate.");
    }
  } catch (err) {
    if (typingInterval) clearInterval(typingInterval);
    if (typingTimeout) clearTimeout(typingTimeout);
    console.error("[bridge] Claude CLI error:", err.message);
    if (chat) { try { await chat.clearState(); } catch {} }

    if (err.message.includes("session") || err.message.includes("resume") || err.message.includes("not found")) {
      console.log("[bridge] Resetting session...");
      activeSession = null;
      try { require("fs").unlinkSync(SESSION_FILE); } catch {}
    }

    // Detect plan usage limit
    const errMsg = (err.message || "").toLowerCase();
    const isUsageLimit = errMsg.includes("usage limit") || errMsg.includes("rate limit") ||
                         errMsg.includes("quota") || errMsg.includes("529") ||
                         errMsg.includes("too many") || errMsg.includes("overloaded");
    if (isUsageLimit && !usageLimitHit) {
      usageLimitHit = true;
      console.log("[bridge] Plan usage limit detected");
      const resetMatch = err.message.match(/(\d+)\s*(h|hour|hora|min|minute|minuto)/i);
      const resetStr = resetMatch ? ` Se restablece en ~${resetMatch[1]}${resetMatch[2]}.` : " Suele restablecerse en 1-5 horas.";
      const limitMsg = `Sin creditos del plan.${resetStr} Te aviso cuando pueda volver a responder.`;
      waClient.sendMessage(jid, limitMsg).catch(() => {});
      // Auto-retry: check every 10 min until limit clears
      const retryInterval = setInterval(async () => {
        try {
          const test = require("child_process").execSync(
            `${process.env.HOME}/.local/bin/claude -p "ok" --model sonnet --dangerously-skip-permissions --output-format json`,
            { cwd: process.env.HOME, timeout: 30000, env: process.env }
          ).toString();
          const parsed = JSON.parse(test);
          if (parsed.result) {
            usageLimitHit = false;
            clearInterval(retryInterval);
            console.log("[bridge] Plan limit cleared, resuming");
            waClient.sendMessage(jid, "Creditos restablecidos. Listo para seguir.").catch(() => {});
          }
        } catch (e) {
          console.log("[bridge] Still rate limited, retrying in 10min...");
        }
      }, 10 * 60 * 1000);
    }
  }

  processQueue();
}

// --- Agent Result Watcher ---
// Checks /tmp/agent-result-*.json every 5s and injects results into Claude leader
setInterval(async () => {
  if (!activeSession || processing) return;
  try {
    const files = readdirSync("/tmp").filter(f => f.startsWith("agent-result-") && f.endsWith(".json"));
    for (const file of files) {
      const filePath = `/tmp/${file}`;
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        unlinkSync(filePath);
        const authorizedJid = config.authorized_numbers[0] + "@c.us";
        const body = `[Subagente: ${data.task || "tarea"}]\n${data.result || data.message || JSON.stringify(data)}`;
        console.log(`[bridge] Agent result received: ${body.substring(0, 80)}...`);
        messageQueue.push({ originalMsg: null, jid: authorizedJid, phone: config.authorized_numbers[0], name: "Agente", body });
        if (!processing) processQueue();
      } catch (e) { console.error("[bridge] Error reading agent result:", e.message); }
    }
  } catch (e) {}
}, 5000);

// --- QR Web Server ---
const qrApp = express();

qrApp.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (isReady) {
    res.send(`<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#25D366">
      <h1 style="color:white">WhatsApp Conectado</h1></body></html>`);
  } else if (currentQR) {
    res.send(`<html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="refresh" content="15">
      <title>WhatsApp QR</title></head>
      <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#eee;margin:0">
      <h2>Escanea con WhatsApp</h2>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}" style="border-radius:12px"/>
      <p style="color:#888;margin-top:16px">Se actualiza cada 15s</p>
      </body></html>`);
  } else {
    res.send(`<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#eee">
      <div style="text-align:center"><h2>Esperando QR...</h2><p>Chromium cargando...</p>
      <meta http-equiv="refresh" content="10"></div></body></html>`);
  }
});

qrApp.listen(QR_PORT, "0.0.0.0", () => {
  console.log(`[bridge] QR web server on http://0.0.0.0:${QR_PORT}`);
});

// --- API Server ---
const api = express();
api.use(express.json());

api.get("/status", (req, res) => {
  res.json({ connected: isReady, qr_available: !!currentQR });
});

api.get("/messages/unread", (req, res) => {
  const msgs = stmtUnread.all();
  res.json(msgs);
});

api.get("/messages/recent", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const msgs = stmtRecent.all(Math.min(limit, 100));
  res.json(msgs.reverse());
});

api.post("/messages/:id/read", (req, res) => {
  stmtMarkRead.run(req.params.id);
  res.json({ ok: true });
});

api.post("/messages/read-all", (req, res) => {
  const result = stmtMarkAllRead.run();
  res.json({ ok: true, marked: result.changes });
});

api.post("/send", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: "phone and message required" });
  }
  if (!isReady) {
    return res.status(503).json({ error: "WhatsApp not connected" });
  }
  try {
    // Try to find the JID from the map, or construct it
    let chatId = jidMap[phone] || `${phone}@c.us`;
    await waClient.sendMessage(chatId, message);

    // Store sent message in DB
    stmtInsert.run(chatId, phone, "me", message, new Date().toISOString(), 1, 1);

    res.json({ ok: true, sent_to: phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Send voice note endpoint ---
api.post("/send-voice", async (req, res) => {
  const { phone, file_path } = req.body;
  if (!phone || !file_path) {
    return res.status(400).json({ error: "phone and file_path required" });
  }
  if (!isReady) {
    return res.status(503).json({ error: "WhatsApp not connected" });
  }
  try {
    let chatId = jidMap[phone] || `${phone}@c.us`;
    const media = MessageMedia.fromFilePath(file_path);
    await waClient.sendMessage(chatId, media, { sendAudioAsVoice: true });
    stmtInsert.run(chatId, phone, "me", "[Nota de voz enviada]", new Date().toISOString(), 1, 1);
    res.json({ ok: true, sent_to: phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.listen(API_PORT, "127.0.0.1", () => {
  console.log(`[bridge] API server on http://127.0.0.1:${API_PORT}`);
});

// --- Start WhatsApp with retry ---
async function startWhatsApp(attempt = 1) {
  try {
    console.log(`[bridge] Initializing WhatsApp (attempt ${attempt})...`);
    await waClient.initialize();
  } catch (e) {
    console.error(`[bridge] Init error (attempt ${attempt}):`, e.message);
    if (attempt < 5) {
      const delay = attempt * 10;
      console.log(`[bridge] Retrying in ${delay}s...`);
      setTimeout(() => startWhatsApp(attempt + 1), delay * 1000);
    } else {
      console.error("[bridge] Failed after 5 attempts. Service will restart via systemd.");
      process.exit(1);
    }
  }
}
startWhatsApp();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[bridge] Shutting down...");
  try {
    await waClient.destroy();
  } catch (e) {}
  db.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[bridge] Interrupted.");
  try {
    await waClient.destroy();
  } catch (e) {}
  db.close();
  process.exit(0);
});
