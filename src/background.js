chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Panel setup failed:', error));

const DEFAULT_STATIONS = [
  { name: 'Cladrite Radio', url: 'http://streaming.live365.com/a43564' },
  { name: 'Conyers 2', url: 'https://s6.yesstreaming.net:17082/stream' }
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
  if (sender.url === chrome.runtime.getURL('offscreen.html') && message.action === 'savePodcastProgress') {
    chrome.storage.local.set({ podcastProgress: message.progress })
      .then(() => sendResponse({ ok: true }), (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (sender.url === chrome.runtime.getURL('offscreen.html') && message.action === 'clearPodcastProgress') {
    chrome.storage.local.remove('podcastProgress')
      .then(() => sendResponse({ ok: true }), (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (sender.url === chrome.runtime.getURL('offscreen.html') && message.action === 'saveLastPlayback') {
    chrome.storage.local.set({ lastPlayback: message.playback })
      .then(() => sendResponse({ ok: true }), (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (!['play', 'playQueue', 'seek', 'goLive', 'resume', 'stop', 'getPlaybackState'].includes(message.action)) return;
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
    if (message.action === 'getPlaybackState') {
      const { lastPlayback } = await chrome.storage.local.get('lastPlayback');
      return { state: lastPlayback || { url: '', name: '', status: 'stopped', error: '' } };
    }
    if (!['play', 'playQueue', 'resume'].includes(message.action)) {
      return { state: { url: '', name: '', status: 'stopped', error: '' } };
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play internet radio stream'
    });
  }
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}
