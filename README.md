# Radio Streamer Side Panel

A Chrome extension for finding and playing internet radio streams, saving stations, and listening to podcast episodes from RSS feeds. The extension runs in Chrome's side panel and uses an offscreen document for audio playback, so playback can continue while the panel is closed.

## Features

- Search stations by name using Radio Browser.
- Choose between Radio Browser's automatic endpoint and its direct `de1` endpoint. These are two endpoints for the same catalog, not separate search engines.
- Play search results or save stations to **My Stations**.
- Add custom stations by name and stream URL.
- Load RSS feeds that provide playable audio enclosures. Review episodes before saving the feed; saved feeds appear in **My Stations**.
- Play episodes in oldest-first or newest-first order, and resume saved playback progress.
- Show track information when a station exposes Icecast JSON or ICY metadata.
- Collapse the search tools and search results, and reorder the main panel sections.

## Install for Testing

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `src` directory, which contains `manifest.json`.
5. Select the extension's toolbar icon to open the side panel.

OR

Head to `https://chromewebstore.google.com/detail/radio-streamer-side-panel/labghloogapmmlnmjpnbjnbndcdggmfi` and install it from the Chrome Web Store.

The extension uses Manifest V3 and Chrome's Side Panel and Offscreen APIs. No build step or package installation is required.

## Use

### Find a Radio Station

1. In **Search Radio Stations**, choose a Radio Browser endpoint.
2. Enter a station name and select **Search**.
3. Select **Play** to listen, or **Save** to add the station to **My Stations**.

The automatic endpoint is the recommended choice. The direct endpoint is available as a fallback if the automatic service has a problem.

### Add a Custom Station

Enter a station name and a direct HTTP or HTTPS stream URL in **Add Custom Station**. Saved stations are synchronized with Chrome Sync when available.

### Listen to an RSS Feed

1. Paste an RSS feed URL into **Podcast Feed** and select **Search Feed**.
2. Grant the requested site access if Chrome prompts. Episodes appear in a collapsed list.
3. Select **Save Feed** to add the feed to **My Stations**.
4. Select a saved feed to load its episodes beneath that feed. Use **Show episodes** to expand the list and choose an episode to play.

The feed must contain RSS `item` entries with playable audio enclosure URLs. A feed page without direct audio entries may not be supported.

## Permissions and Data

- `sidePanel`: displays the player in Chrome's side panel.
- `offscreen`: keeps audio playback in an offscreen extension document.
- `storage`: saves stations and feeds with Chrome Sync and keeps panel preferences and podcast playback progress locally.
- Radio Browser host access: used for station searches.
- Optional HTTP/HTTPS host access: requested for feed fetching and station track metadata. Chrome may prompt the first time a host is used. Audio playback can work even when track metadata is unavailable.

Saved station and feed entries are synchronized through Chrome Sync. Panel layout preferences, the last podcast feed, and podcast playback position are stored locally. The extension does not require a radio streaming account.

## Troubleshooting

- **Radio search fails:** Switch between **Radio Browser (automatic)** and **Radio Browser (direct server)**. Both use the Radio Browser catalog, and either endpoint can be temporarily unavailable.
- **A feed does not load:** Check the URL, grant site access when prompted, and confirm the feed contains playable audio enclosures. A site may block extension requests or redirect to another host.
- **A station will not play:** The stream may be offline or use an audio format unsupported by Chrome.
- **No track information appears:** Many stations do not publish Icecast JSON or ICY metadata. Playback can continue without track information.

## Project Files

- `src/manifest.json`: extension manifest and permissions.
- `src/sidepanel.html` and `src/sidepanel.js`: side-panel UI and player controls.
- `src/background.js`: extension service worker and offscreen playback coordination.
- `src/offscreen.html` and `src/offscreen.js`: audio playback, podcast queue, and progress tracking.
- `src/metadata.js`: Icecast and ICY track metadata detection.
