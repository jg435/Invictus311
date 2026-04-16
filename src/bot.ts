import "dotenv/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import TelegramBot from "node-telegram-bot-api";
import { chat } from "./llm";
import { initMCP } from "./mcp";

// Track last photo per chat for ticket attachment
const lastPhotos = new Map<number, string>();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN not set in .env");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Per-chat conversation history
const histories = new Map<number, unknown[]>();
const MAX_HISTORY = 30; // keep last 30 messages to avoid token overflow

function getHistory(chatId: number) {
  if (!histories.has(chatId)) histories.set(chatId, []);
  return histories.get(chatId)!;
}

function trimHistory(chatId: number) {
  const h = getHistory(chatId);
  if (h.length > MAX_HISTORY) {
    histories.set(chatId, h.slice(-MAX_HISTORY));
  }
}

console.log("Boston 311 Bot starting...");

// Connect to local MCP server for Boston Open Data
initMCP().catch((e) => console.log("MCP not available:", e.message));

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Ignore non-text, non-photo messages
  if (!msg.text && !msg.photo) return;

  // Show typing indicator
  bot.sendChatAction(chatId, "typing");

  try {
    let imageUrl: string | undefined;
    let userText = msg.text || "";

    // Handle photos — download and convert to base64 for the LLM
    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1]; // highest resolution
      const file = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      // Download the image
      const imgRes = await fetch(fileUrl);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      // Save to temp file for Playwright upload
      const ext = file.file_path?.split(".").pop() || "jpg";
      const tempPath = path.join(os.tmpdir(), `boston311-${chatId}-${Date.now()}.${ext}`);
      fs.writeFileSync(tempPath, imgBuffer);
      lastPhotos.set(chatId, tempPath);

      // Convert to base64 for the LLM vision
      const base64 = imgBuffer.toString("base64");
      const mime = ext === "png" ? "image/png" : "image/jpeg";
      imageUrl = `data:${mime};base64,${base64}`;

      userText = msg.caption || "";
      console.log(`Photo received from ${chatId}, ${imgBuffer.length} bytes, saved to ${tempPath}`);
    }

    // Skip empty messages
    if (!userText && !imageUrl) return;

    const history = getHistory(chatId);

    const photoPath = lastPhotos.get(chatId);

    const result = await chat(
      chatId,
      history as Parameters<typeof chat>[1],
      userText,
      imageUrl,
      (status) => {
        bot.sendMessage(chatId, status).catch(() => {});
        bot.sendChatAction(chatId, "typing").catch(() => {});
      },
      photoPath
    );

    // Update history
    histories.set(chatId, result.history);
    trimHistory(chatId);

    // Send reply (split long messages)
    const reply = result.reply;
    if (reply.length <= 4096) {
      await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" }).catch(() =>
        // Fallback without markdown if parsing fails
        bot.sendMessage(chatId, reply)
      );
    } else {
      // Split into chunks
      for (let i = 0; i < reply.length; i += 4096) {
        await bot.sendMessage(chatId, reply.slice(i, i + 4096));
      }
    }
  } catch (err) {
    console.error("Error handling message:", err);
    await bot.sendMessage(
      chatId,
      "Sorry, I ran into an error processing your request. Please try again."
    );
  }
});

// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  histories.delete(chatId); // fresh start
  bot.sendMessage(
    chatId,
    `*Welcome to Boston 311* 🏙️

I'm your multilingual city services assistant. I can help you:

📋 *Report an issue* — potholes, graffiti, trash, noise, broken streetlights
🔍 *Look up cases* — search 311 requests by neighborhood or type
📊 *Get stats* — see what's happening in your neighborhood
📸 *Send a photo* — I'll analyze it and help you file a report
🌍 *Any language* — just write in your language, I'll respond in kind

Try saying something like:
• "What are the top issues in Roxbury this week?"
• "I want to report a pothole on Main St"
• "¿Hay problemas de basura en East Boston?"

How can I help?`,
    { parse_mode: "Markdown" }
  );
});

// /clear command
bot.onText(/\/clear/, (msg) => {
  histories.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, "Conversation cleared. How can I help?");
});

console.log("Bot is running! Send a message on Telegram.");
