"""
Boston 311 — Live Ticket Dashboard
Flask web server that shows filed tickets in real-time.
Run alongside the Telegram bot for a killer demo.
"""

import os
import json
from flask import Flask, render_template, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

TICKETS_FILE = os.path.join(os.path.dirname(__file__), "tickets.json")


def load_tickets():
    """Load tickets from the shared JSON file."""
    if os.path.exists(TICKETS_FILE):
        with open(TICKETS_FILE) as f:
            return json.load(f)
    return []


@app.route("/")
def index():
    return render_template("dashboard.html")


@app.route("/api/tickets")
def api_tickets():
    tickets = load_tickets()
    return jsonify(tickets)


@app.route("/api/stats")
def api_stats():
    tickets = load_tickets()
    stats = {
        "total": len(tickets),
        "open": sum(1 for t in tickets if t.get("status") == "OPEN"),
        "high_priority": sum(1 for t in tickets if t.get("urgency") == "high"),
        "by_type": {},
        "by_department": {},
        "by_urgency": {"low": 0, "medium": 0, "high": 0},
    }
    for t in tickets:
        itype = t.get("type", "other")
        dept = t.get("department", "Unknown")
        urg = t.get("urgency", "medium")
        stats["by_type"][itype] = stats["by_type"].get(itype, 0) + 1
        stats["by_department"][dept] = stats["by_department"].get(dept, 0) + 1
        stats["by_urgency"][urg] = stats["by_urgency"].get(urg, 0) + 1
    return jsonify(stats)


if __name__ == "__main__":
    print("🖥️  Dashboard running at http://localhost:5050")
    app.run(port=5050, debug=True)
