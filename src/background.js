chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Panel setup failed:', error));

const DEFAULT_STATIONS = [
  { name: 'Cladrite Radio', url: 'http://streaming.live365.com/a43564' },
  { name: 'Conyers 1', url: 'https://s8.yesstreaming.net:17011/stream' },
  { name: 'Conyers 2', url: 'https://s6.yesstreaming.net:17082/stream' },
];
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.storage.sync.get(['radioStations'], (result) => {
      if (!result.radioStations) chrome.storage.sync.set({ radioStations: DEFAULT_STATIONS });
    });
  }
});

// Serialize commands so a rapid Stop or station switch cannot overtake Play.
let commands = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'background') return;
  if (!['play', 'stop', 'getPlaybackState'].includes(message.action)) return;
  const operation = commands.then(() => handleCommand(message));
  commands = operation.catch(() => {});
  operation.then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

async function handleCommand(message) {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });
  if (!contexts.length) {
    if (message.action !== 'play') return { state: { url: '', name: '', status: 'stopped', error: '' } };
    await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play internet radio stream'
    });
  }
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}
