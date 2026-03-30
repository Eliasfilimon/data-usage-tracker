# Data Usage Tracker

A browser-based website that tracks and visualises your network data usage in real time — no server required.

## Features

- **Session data usage** – total bytes transferred since the page loaded, powered by the [Performance Resource Timing API](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Resource_timing)
- **Live updates** – stats refresh automatically via a `PerformanceObserver` and a polling fallback
- **Resource breakdown** – bytes grouped by resource type (script, CSS, image, fetch, font, …)
- **Bar chart** – visual comparison of data used per type, rendered on an HTML5 Canvas
- **Top resources table** – top 50 heaviest resources with size, load duration and protocol
- **Data limit** – set a custom limit (KB / MB / GB); a progress bar warns at 80 % and 100 %
- **Session history** – previous sessions are saved in `localStorage` and shown in a history panel
- **Network info** – displays effective connection type and downlink speed via the [Network Information API](https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API)
- **Online / offline detection** – banner notifies you when connectivity changes
- **Dark theme** – fully responsive UI

## Usage

Open `index.html` directly in any modern browser — no build step or dependencies needed.

```
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

Or serve with any static file server:

```
npx serve .
python3 -m http.server 8080
```

## Browser Support

| Feature | Chrome | Firefox | Edge | Safari |
|---|---|---|---|---|
| Performance API | ✅ | ✅ | ✅ | ✅ |
| Network Information API | ✅ | ⚠ partial | ✅ | ❌ |
| PerformanceObserver | ✅ | ✅ | ✅ | ✅ |

## Files

| File | Description |
|---|---|
| `index.html` | Page structure |
| `styles.css` | Dark-theme responsive styles |
| `app.js` | Tracking logic, rendering, localStorage |
