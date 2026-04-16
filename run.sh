#!/bin/bash
# Quick launch script for Boston 311 Bot
# Usage: ./run.sh

echo "🏛️  Boston 311 Bot — Launch"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check env vars
if [ -z "$TELEGRAM_TOKEN" ]; then
    echo "⚠️  Set TELEGRAM_TOKEN first:"
    echo "   export TELEGRAM_TOKEN='your-bot-token'"
    echo ""
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠️  Set ANTHROPIC_API_KEY first:"
    echo "   export ANTHROPIC_API_KEY='your-api-key'"
    echo ""
fi

# Start dashboard in background
echo "🖥️  Starting dashboard on http://localhost:5050 ..."
python3 dashboard.py &
DASH_PID=$!
echo "   Dashboard PID: $DASH_PID"

# Short delay
sleep 1

# Start bot in foreground
echo "🤖 Starting Telegram bot..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
python3 bot.py

# Cleanup
kill $DASH_PID 2>/dev/null
