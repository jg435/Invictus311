# Boston 311 Bot — Messaging-to-Ticket AI Agent

Residents text, message, or email city issues → AI (Claude Vision) classifies it → Playwright automates the ticket creation on the official 311 website.

## Quick Start Guide 

### 1. Create Telegram Bot
1. Open Telegram → search `@BotFather`
2. Send: `/newbot`
3. Name it: `Boston311Bot`
4. Copy the **TOKEN**

### 2. Environment Setup 
To install dependencies and Set Environment Variables

```bash
cd /Users/kavachshah/.gemini/antigravity/scratch/boston-311-bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

```bash
export TELEGRAM_TOKEN="your-telegram-token-here"
export ANTHROPIC_API_KEY="your-anthropic-key-here"
```

### 3. Run the Bot
```bash
# Start both the web dashboard and your Bot
bash run.sh
```

### 4. Demo
- Open Telegram → message your bot with a **photo of an issue** (e.g. a pothole)
- The bot will analyze the image, classify the issue, and spin up a headless Chromium browser to fill the official 311 form automatically! 
- It will send you back a screenshot of the filled form for confirmation.
- Open `http://localhost:5050` → watch the ticket populate on your command center dashboard.

## Architecture
```
Resident (Telegram/SMS/Email)
        ↓
  Bot receives photo & message
        ↓
  Claude 3.5 Vision extracts:
  • Issue type
  • Location  
  • Urgency
        ↓
  Playwright Automation 
  (Fills real 311 web-form + screenshot)
        ↓
  Confirmation sent back
  + Live Dashboard updated
```

## Files
- `bot.py` — Telegram bot async tasks, Claude AI extraction, and Playwright automation
- `dashboard.py` — Flask web dashboard (live at :5050)
- `templates/dashboard.html` — Premium dark-mode command center UI
- `tickets.json` — Shared ticket store (auto-created)
