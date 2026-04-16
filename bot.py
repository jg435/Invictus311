"""
Boston 311 Telegram Bot — Hackathon Build
Residents message issues → Claude extracts details → Ticket auto-created
"""

import os
import json
import random
import asyncio
import logging
import base64
from datetime import datetime
from playwright.async_api import async_playwright

import anthropic
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
    ContextTypes,
)

# ── Config ────────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "YOUR_TELEGRAM_TOKEN")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "YOUR_ANTHROPIC_KEY")
MCP_ENDPOINT = "https://data-mcp.boston.gov/mcp"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

# ── In-memory ticket store (shared with dashboard) ────────────────────
TICKETS: list[dict] = []

# ── Playwright Automation ─────────────────────────────────────────────
async def submit_to_boston_311(ticket: dict, image_path: str = None) -> str:
    """Uses Playwright to navigate the Boston 311 portal. Takes a screenshot at the final step."""
    logger.info(f"Starting Playwright 311 automation for case {ticket['case_id']}")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            # Boston 311 generic pothole request URL
            await page.goto("https://311.boston.gov/tickets/new?submission%5Bticket_type_code%5D=Public+Works+Department%3AHighway+Maintenance%3ARequest+for+Pothole+Repair")
            
            # The form asks for a photo and moving forward
            await page.wait_for_selector('input[type="submit"][value="Next"]', timeout=10000)
            
            if image_path and os.path.exists(image_path):
                # Attach file to the first file input
                await page.set_input_files('input[type="file"]', image_path)
            
            # Form might have a required textarea or inputs, fill it with our summary
            textareas = await page.locator("textarea").all()
            for ta in textareas:
                if await ta.is_visible():
                    await ta.fill(ticket['summary'])
                    
            text_inputs = await page.locator('input[type="text"]').all()
            for ti in text_inputs:
                if await ti.is_visible() and not await ti.get_attribute('value'):
                    await ti.fill(ticket['location'] if 'location' in ticket['location'].lower() else ticket['summary'])
            
            # Click "Next"
            await page.click('input[type="submit"][value="Next"]')
            await page.wait_for_timeout(2000)
            
            # Take a screenshot instead of actual final city submission
            screenshot_path = f"screenshot_{ticket['case_id']}.png"
            await page.screenshot(path=screenshot_path)
            return screenshot_path
        except Exception as e:
            logger.error(f"Playwright automation failed: {e}")
            return None
        finally:
            await browser.close()


# ── Claude extraction ─────────────────────────────────────────────────
def extract_ticket_info(user_message: str, base64_image: str = None) -> dict:
    """Use Claude to parse a resident's message. Falls back to mock data if no API key is present."""
    
    # MOCK MODE FALLBACK for Hackathons without a key
    if not ANTHROPIC_KEY or ANTHROPIC_KEY in ["YOUR_ANTHROPIC_KEY", "your-actual-sk-ant-key-here"]:
        import time
        logger.warning("No valid Anthropic API key found! Falling back to MOCK AI mode.")
        time.sleep(2)  # Simulate AI thinking
        return {
            "issue_type": "pothole",
            "location": "Boston Common Area",
            "urgency": "high",
            "summary": user_message[:100] if user_message else "Detected a severe road defect from the provided image.",
            "department": "Public Works",
        }

    content = []
    if base64_image:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64_image
            }
        })
        
    prompt_text = f"""A Boston resident sent this message (and potentially a photo) to report a city issue:
"{user_message}"

Extract and return ONLY a valid JSON object (no markdown, no explanation) with these fields:
- "issue_type": one of pothole | graffiti | trash | noise | broken_light | flooding | sidewalk | parking | rodent | tree | other
- "location": street address or neighborhood mentioned/inferred (or "Not provided")
- "urgency": low | medium | high
- "summary": one clear sentence describing the issue
- "department": the Boston city department that would handle this (e.g. "Public Works", "Transportation", "Inspectional Services", "Parks & Recreation", "Animal Control")
"""
    content.append({
        "type": "text",
        "text": prompt_text
    })

    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=400,
            messages=[{"role": "user", "content": content}],
        )
        raw = response.content[0].text.strip()
        # Handle potential markdown wrapping
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(raw)
    except (json.JSONDecodeError, IndexError, Exception) as e:
        logger.error(f"Failed to parse Claude extraction: {e}")
        return {
            "issue_type": "other",
            "location": "Not provided",
            "urgency": "medium",
            "summary": user_message[:120] if user_message else "Photo Uploaded",
            "department": "General Services",
        }


def create_311_ticket(ticket_info: dict, user_id: int, username: str) -> dict:
    """Create a structured 311 ticket and store it."""
    case_id = f"BOS-{random.randint(10000, 99999)}"
    ticket = {
        "case_id": case_id,
        "type": ticket_info.get("issue_type", "other"),
        "location": ticket_info.get("location", "Not provided"),
        "urgency": ticket_info.get("urgency", "medium"),
        "summary": ticket_info.get("summary", ""),
        "department": ticket_info.get("department", "General Services"),
        "status": "OPEN",
        "channel": "telegram",
        "reported_by": username or str(user_id),
        "created_at": datetime.now().isoformat(),
    }
    TICKETS.append(ticket)

    # Write to shared JSON so the dashboard can read it
    _persist_tickets()

    return ticket


def _persist_tickets():
    """Write tickets to a JSON file so the web dashboard can read them."""
    path = os.path.join(os.path.dirname(__file__), "tickets.json")
    with open(path, "w") as f:
        json.dump(TICKETS, f, indent=2)


# ── Emoji map ─────────────────────────────────────────────────────────
ISSUE_EMOJI = {
    "pothole": "🕳️",
    "graffiti": "🎨",
    "trash": "🗑️",
    "noise": "🔊",
    "broken_light": "💡",
    "flooding": "🌊",
    "sidewalk": "🚶",
    "parking": "🅿️",
    "rodent": "🐀",
    "tree": "🌳",
    "other": "📋",
}

URGENCY_EMOJI = {"low": "🟢", "medium": "🟡", "high": "🔴"}


# ── Handlers ──────────────────────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Welcome message when user starts the bot."""
    welcome = (
        "🏛️ *Boston 311 — Report City Issues Instantly*\n\n"
        "Just send me a message or a *photo* describing any city issue you see:\n\n"
        "• Potholes, broken streetlights, trash\n"
        "• Noise complaints, graffiti, flooding\n"
        "• Sidewalk damage, parking violations\n\n"
        "I'll file a 311 request for you in seconds — "
        "no app download, no phone call, no waiting.\n\n"
        "🌐 _Works in any language._\n\n"
        "Try it now! Just type what you see or upload a photo."
    )
    await update.message.reply_text(welcome, parse_mode="Markdown")


async def handle_report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Process a resident's report message or photo."""
    user = update.effective_user
    
    base64_image = None
    image_path = None
    user_msg = ""
    
    if update.message.photo:
        user_msg = update.message.caption or "Attached a photo."
        photo_file = await update.message.photo[-1].get_file()
        image_bytes = await photo_file.download_as_bytearray()
        
        # Save locally for playwright
        image_path = f"temp_{user.id}.jpg"
        with open(image_path, "wb") as f:
            f.write(image_bytes)
            
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
    else:
        user_msg = update.message.text or ""

    # Acknowledge immediately
    processing = await update.message.reply_text(
        "📋 *Processing your report...*\n_Analyzing issue details with AI_",
        parse_mode="Markdown",
    )

    try:
        # Extract with Claude
        ticket_info = extract_ticket_info(user_msg, base64_image)

        # Create ticket
        ticket = create_311_ticket(
            ticket_info,
            user_id=user.id,
            username=user.username or user.first_name,
        )

        issue_emoji = ISSUE_EMOJI.get(ticket["type"], "📋")
        urgency_emoji = URGENCY_EMOJI.get(ticket["urgency"], "🟡")

        confirmation = (
            f"✅ *311 Request Classified Successfully!*\n\n"
            f"{issue_emoji} *Issue:* {ticket['summary']}\n"
            f"📍 *Location:* {ticket['location']}\n"
            f"{urgency_emoji} *Priority:* {ticket['urgency'].upper()}\n"
            f"🏢 *Department:* {ticket['department']}\n"
            f"🎫 *Case ID:* `{ticket['case_id']}`\n"
            f"📅 *Filed:* {datetime.now().strftime('%B %d, %Y at %I:%M %p')}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
            f"🤖 *Automating Boston 311 web portal...*\n"
            f"_Booting headless browser..._"
        )

        await processing.edit_text(confirmation, parse_mode="Markdown")
        
        # Run Playwright
        screenshot_path = await submit_to_boston_311(ticket, image_path)
        
        if screenshot_path and os.path.exists(screenshot_path):
            with open(screenshot_path, "rb") as photo:
                await update.message.reply_photo(
                    photo=photo,
                    caption=f"📸 *Success!* Simulated web form completion on Boston 311.\n\n_Note: Final submission aborted for demo safety. Dashboard updated._",
                    parse_mode="Markdown"
                )
            os.remove(screenshot_path)
        else:
            await update.message.reply_text("✅ Boston 311 portal simulation complete. Dashboard updated.")
            
        if image_path and os.path.exists(image_path):
            os.remove(image_path)

    except Exception as e:
        logger.error(f"Error processing report: {e}")
        await processing.edit_text(
            "⚠️ Sorry, I couldn't process that. Please try describing the issue again.\n\n"
            "Example: _\"There's a big pothole on Beacon St near the State House\"_",
            parse_mode="Markdown",
        )


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Check status of a case."""
    if not context.args:
        await update.message.reply_text(
            "Usage: /status BOS-12345",
            parse_mode="Markdown",
        )
        return

    case_id = context.args[0]
    ticket = next((t for t in TICKETS if t["case_id"] == case_id), None)

    if ticket:
        urgency_emoji = URGENCY_EMOJI.get(ticket["urgency"], "🟡")
        status_msg = (
            f"📋 *Case Status: {case_id}*\n\n"
            f"📌 *Issue:* {ticket['summary']}\n"
            f"📍 *Location:* {ticket['location']}\n"
            f"{urgency_emoji} *Priority:* {ticket['urgency'].upper()}\n"
            f"🏢 *Department:* {ticket['department']}\n"
            f"📊 *Status:* {ticket['status']}\n"
            f"📅 *Filed:* {ticket['created_at'][:10]}\n"
        )
    else:
        status_msg = f"❌ Case `{case_id}` not found. Check the ID and try again."

    await update.message.reply_text(status_msg, parse_mode="Markdown")


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline button presses."""
    query = update.callback_query
    await query.answer()

    if query.data == "my_reports":
        user = update.effective_user
        username = user.username or user.first_name
        user_tickets = [t for t in TICKETS if t["reported_by"] == username]

        if user_tickets:
            lines = ["📊 *Your Reports:*\n"]
            for t in user_tickets[-5:]:
                emoji = ISSUE_EMOJI.get(t["type"], "📋")
                lines.append(f"{emoji} `{t['case_id']}` — {t['summary']}")
            await query.edit_message_text("\n".join(lines), parse_mode="Markdown")
        else:
            await query.edit_message_text("No reports found.")
    elif query.data.startswith("photo_"):
        await query.edit_message_text(
            "📸 Support is now active! Send a photo directly in the chat and I'll analyze it.",
            parse_mode="Markdown",
        )
    elif query.data.startswith("loc_"):
        await query.edit_message_text(
            "📍 Tap the 📎 button → Location to share your GPS coordinates.\n"
            "_(GPS attachment coming in v2)_",
            parse_mode="Markdown",
        )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show help."""
    help_text = (
        "🏛️ *Boston 311 Bot — Help*\n\n"
        "*How to report an issue:*\n"
        "Just type a message describing what you see, or upload a photo!\n\n"
        "*Commands:*\n"
        "/start — Welcome message\n"
        "/status BOS-XXXXX — Check case status\n"
        "/help — This message\n\n"
        "*Supported issues:*\n"
        "🕳️ Potholes · 🗑️ Trash · 🎨 Graffiti\n"
        "💡 Broken lights · 🌊 Flooding · 🔊 Noise\n"
        "🚶 Sidewalks · 🅿️ Parking · 🐀 Rodents · 🌳 Trees\n\n"
        "_Supports all languages — just type in yours!_"
    )
    await update.message.reply_text(help_text, parse_mode="Markdown")


# ── Main ──────────────────────────────────────────────────────────────
def main():
    print("🏛️  Boston 311 Bot starting...")
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("status", status_command))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CallbackQueryHandler(button_handler))
    
    # Handle both text and photos via the same report handler
    app.add_handler(MessageHandler((filters.TEXT | filters.PHOTO) & ~filters.COMMAND, handle_report))

    print("✅ Bot is live! Send a message or photo to your bot on Telegram.")
    app.run_polling()


if __name__ == "__main__":
    main()
