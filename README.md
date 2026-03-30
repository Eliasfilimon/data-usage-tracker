# Data Usage Tracker

A lightweight, **browser-based** daily internet data usage tracker.  
No server, no accounts — all data is stored in your browser's **localStorage**.

## Features

| Feature | Details |
|---|---|
| 📊 Daily dashboard | Instant totals for today's downloads, uploads, and sessions |
| ➕ Log entries | Record data used by any app or service (MB) with a category and optional note |
| 📅 Date picker | Log usage for any past or current date |
| 📈 Usage chart | Bar chart spanning 7, 14, or 30 days (powered by Chart.js) |
| 🔍 Search | Filter entries by app name, category, date, or note |
| ⚠️ Daily limit | Set an optional daily MB cap with a colour-coded progress bar |
| 💾 Export CSV | Download all entries as a CSV file |
| 🗑️ Clear all | Bulk-delete all entries with a confirmation prompt |
| 🌑 Dark theme | Sleek dark UI, fully responsive down to mobile |

## Getting started

### Option 1 — open directly in a browser

```bash
# Clone the repository
git clone https://github.com/Eliasfilimon/data-usage-tracker.git
cd data-usage-tracker

# Open index.html in your default browser
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

### Option 2 — serve with any static file server

```bash
# Using Python (built-in)
python -m http.server 8080
# then visit http://localhost:8080
```

## Project structure

```
data-usage-tracker/
├── index.html          # Single-page app shell
├── css/
│   └── style.css       # All styles (dark theme, responsive)
└── js/
    └── app.js          # App logic, localStorage persistence, chart
```

## How to use

1. **Add an entry** — fill in the form at the top:
   - Pick a date (defaults to today)
   - Enter the app / service name (e.g. *YouTube*, *Chrome*, *Zoom*)
   - Choose a category
   - Enter downloaded MB and/or uploaded MB
   - Optionally add a short note
   - Click **Add Entry**

2. **View today's totals** — the four cards at the top update instantly.

3. **Set a daily limit** — click ⚙ **Settings**, enter a limit in MB (e.g. `5120` for 5 GB).  
   The progress bar turns amber at 70 % and red at 90 %.

4. **Browse history** — the table shows all entries, sortable by date.  
   Use the search box to filter.

5. **Export** — click **Export CSV** to download all entries.

## Data storage

All data lives in `localStorage` under two keys:

| Key | Contents |
|---|---|
| `dut_entries` | JSON array of usage entries |
| `dut_settings` | JSON object with `dailyLimitMB` |

Data persists until you clear browser storage or click **Clear All**.

## Browser support

Works in any modern browser that supports:
- `localStorage`
- `CSS custom properties`
- `<canvas>` (for the chart)

Tested in Chrome 120+, Firefox 121+, Safari 17+, Edge 120+.
