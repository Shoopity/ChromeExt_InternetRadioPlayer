// Open side panel when action icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error("Error setting panel behavior: ", e));

// Handle default stations on installation
const DEFAULT_STATIONS = [
  { name: "New York NY", url: "https://icecast.walmradio.com:8443/classic" },
  { name: "Adroit Jazz Underground", url: "https://icecast.walmradio.com:8443/jazz" }
];

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.storage.sync.get(['radioStations'], (result) => {
      if (!result.radioStations) {
        chrome.storage.sync.set({ radioStations: DEFAULT_STATIONS });
      }
    });
  }
});

// Audio message routing via Offscreen Document
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.action === "play") {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ action: "startAudio", url: message.url });
  } else if (message.action === "stop") {
    chrome.runtime.sendMessage({ action: "stopAudio" });
  }
});

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play internet radio stream"
    });
  }
}
