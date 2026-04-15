#!/usr/bin/env node

const fs = require("fs");
const LOG_FILE = "./data/whatsapp.log";
const AUTH_PATH = "./data/auth";

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

log("Loading modules...");

async function main() {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    makeCacheableSignalKeyStore,
  } = require("@whiskeysockets/baileys");
  const qrcode = require("qrcode-terminal");

  log("Modules loaded. Starting MCP server...");

  // Dynamic import for ESM-only MCP SDK
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");

  log("MCP SDK loaded.");

  let sock = null;
  let isReady = false;
  const recentMessages = [];
  const MAX_STORED = 50;

  async function connectWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, {
          level: "silent",
          child: () => ({ level: "silent", child: () => ({ level: "silent" }) }),
        }),
      },
      printQRInTerminal: false,
      logger: {
        level: "silent",
        child: () => ({
          level: "silent",
          child: () => ({ level: "silent" }),
        }),
      },
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        log("QR code received - scan with WhatsApp");
        qrcode.generate(qr, { small: true }, (code) => {
          log("\n" + code);
          process.stderr.write("\n===== SCAN THIS QR WITH WHATSAPP =====\n");
          process.stderr.write(code);
          process.stderr.write("=======================================\n\n");
        });
      }

      if (connection === "open") {
        isReady = true;
        log("WhatsApp connected!");
      }

      if (connection === "close") {
        isReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut) {
          log("Disconnected, reconnecting...");
          connectWhatsApp();
        } else {
          log("Logged out.");
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          "";
        recentMessages.push({
          from: msg.key.remoteJid,
          body: text,
          timestamp: new Date((msg.messageTimestamp || 0) * 1000).toISOString(),
          fromMe: msg.key.fromMe,
          pushName: msg.pushName || msg.key.remoteJid,
        });
        if (recentMessages.length > MAX_STORED) recentMessages.shift();
      }
    });
  }

  // MCP Server
  const server = new McpServer({
    name: "whatsapp",
    version: "1.0.0",
  });

  server.tool(
    "send_message",
    "Send a WhatsApp message to a phone number",
    {
      phone: z.string().describe("Phone number with country code, e.g. 584121234567"),
      message: z.string().describe("Message text to send"),
    },
    async ({ phone, message }) => {
      if (!isReady || !sock) {
        return {
          content: [{ type: "text", text: "WhatsApp not connected. Use get_status to check." }],
          isError: true,
        };
      }
      try {
        const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        return { content: [{ type: "text", text: `Message sent to ${phone}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_messages",
    "Get recent incoming WhatsApp messages",
    {
      limit: z.number().optional().default(10).describe("Number of recent messages to return"),
    },
    async ({ limit }) => {
      const msgs = recentMessages.slice(-limit);
      if (msgs.length === 0) {
        return { content: [{ type: "text", text: "No recent messages." }] };
      }
      const formatted = msgs
        .map((m) => `[${m.timestamp}] ${m.pushName}: ${m.body}`)
        .join("\n");
      return { content: [{ type: "text", text: formatted }] };
    }
  );

  server.tool("get_status", "Check WhatsApp connection status", {}, async () => {
    return {
      content: [{ type: "text", text: `WhatsApp status: ${isReady ? "Connected" : "Disconnected"}` }],
    };
  });

  server.tool("get_chats", "List recent WhatsApp chats", {}, async () => {
    if (!isReady || !sock) {
      return { content: [{ type: "text", text: "WhatsApp not connected." }], isError: true };
    }
    const chatMap = new Map();
    for (const m of recentMessages) {
      if (!m.fromMe) {
        chatMap.set(m.from, { name: m.pushName, lastMsg: m.body, time: m.timestamp });
      }
    }
    const chats = Array.from(chatMap.entries()).map(([jid, c]) => ({
      jid,
      name: c.name,
      lastMessage: c.lastMsg?.substring(0, 80),
      time: c.time,
    }));
    return { content: [{ type: "text", text: JSON.stringify(chats, null, 2) }] };
  });

  log("Connecting WhatsApp...");
  connectWhatsApp().catch((e) => log(`Init error: ${e.message}`));

  log("Starting MCP transport...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running.");
}

main().catch((e) => {
  log(`Fatal error: ${e.message}\n${e.stack}`);
  process.exit(1);
});
