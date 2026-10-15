const player = document.getElementById('audio-player');
let state = { url: '', name: '', status: 'stopped', error: '' };
let generation = 0;
let queue = [];
let queueIndex = -1;
let feedUrl = '';
let pendingSeek = null;
let lastProgressWrite = 0;

function publish() {
  chrome.runtime.sendMessage({ target: 'panel', action: 'playbackState', state })
    .catch(() => {}); // Playback also works while no panel is open.
}

function disconnect() {
  player.pause();
  player.removeAttribute('src');
  player.load(); // Abort the request and discard buffered audio.
  pendingSeek = null;
}

function saveProgress(force = false, currentTime = player.currentTime) {
  const episode = queue[queueIndex];
  if (!episode) return;
  const now = Date.now();
  if (!force && now - lastProgressWrite < 15000) return;
  lastProgressWrite = now;
  chrome.runtime.sendMessage({
    target: 'background',
    action: 'savePodcastProgress',
    progress: {
      feedUrl,
      episodeId: episode.id,
      currentTime: Number.isFinite(currentTime) ? currentTime : 0
    }
  }).catch(() => {});
}

function startEpisode(index, position = 0) {
  const episode = queue[index];
  if (!episode) return;
  const request = ++generation;
  disconnect();
  queueIndex = index;
  pendingSeek = position > 0 ? position : null;
  state = {
    url: episode.url,
    name: episode.title,
    status: 'loading',
    error: '',
    kind: 'podcast',
    feedUrl,
    episodeId: episode.id,
    episodeIndex: index,
    episodeCount: queue.length,
    currentTime: position
  };
  saveProgress(true, position);
  player.crossOrigin = 'anonymous';
  player.src = episode.url;
  publish();
  player.play().catch((error) => {
    if (request === generation && state.status !== 'error') {
      fail(`Playback failed: ${error.message}`);
    }
  });
}

function fail(message) {
  saveProgress(true);
  generation++;
  disconnect();
  state = { ...state, status: 'error', error: message };
  publish();
}

player.addEventListener('playing', () => {
  if (!state.url || player.paused || !player.hasAttribute('src')) return;
  state = { ...state, status: 'playing', error: '' };
  publish();
});
player.addEventListener('loadedmetadata', () => {
  if (pendingSeek === null || !player.hasAttribute('src')) return;
  try {
    player.currentTime = pendingSeek;
  } catch (error) {
    console.warn('Unable to restore podcast position:', error);
  }
  pendingSeek = null;
});
player.addEventListener('timeupdate', () => {
  if (queueIndex < 0) return;
  state = { ...state, currentTime: player.currentTime };
  saveProgress();
});
for (const event of ['waiting', 'stalled']) {
  player.addEventListener(event, () => {
    if (!state.url || !player.hasAttribute('src') || state.status === 'error') return;
    state = { ...state, status: 'loading' };
    publish();
  });
}
player.addEventListener('error', () => {
  if (player.error && state.url && player.hasAttribute('src')) {
    const reasons = {
      1: 'Playback was interrupted while loading the audio',
      2: 'A network error occurred while loading the audio',
      3: 'The audio file could not be decoded',
      4: 'The URL returned an unsupported audio format'
    };
    const reason = reasons[player.error.code] || 'The audio could not be loaded';
    const mp3Support = player.canPlayType('audio/mpeg') || 'no';
    let sourceHost = 'unknown source';
    try {
      sourceHost = new URL(player.currentSrc || state.url).host;
    } catch {}
    fail(`${reason} (media error ${player.error.code}; MP3 support: ${mp3Support}; source: ${sourceHost}).`);
  }
});
player.addEventListener('ended', () => {
  if (!state.url || !player.ended) return;
  if (queueIndex >= 0) {
    if (queueIndex + 1 < queue.length) {
      startEpisode(queueIndex + 1);
    } else {
      const lastEpisode = queue[queueIndex];
      generation++;
      disconnect();
      chrome.runtime.sendMessage({ target: 'background', action: 'clearPodcastProgress' }).catch(() => {});
      queue = [];
      queueIndex = -1;
      feedUrl = '';
      state = { url: '', name: lastEpisode.title, status: 'completed', error: '', kind: 'podcast' };
      publish();
    }
    return;
  }
  fail('The stream ended. Click Play to reconnect.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  if (message.action === 'play') {
    saveProgress(true);
    queue = [];
    queueIndex = -1;
    feedUrl = '';
    const request = ++generation;
    disconnect();
    state = { url: message.url, name: message.name || 'Radio station', status: 'loading', error: '', kind: 'live' };
    player.removeAttribute('crossorigin');
    player.src = message.url;
    publish();
    // Do not await play: Stop must work even while a stream is connecting.
    player.play().catch((error) => {
      if (request === generation && state.status !== 'error') {
        fail(`Playback failed: ${error.message}`);
      }
    });
  } else if (message.action === 'playQueue') {
    if (!Array.isArray(message.queue) || !message.queue.length || !message.feedUrl) {
      sendResponse({ error: 'The podcast feed has no playable episodes.' });
      return;
    }
    feedUrl = message.feedUrl;
    queue = message.queue;
    startEpisode(message.index || 0, message.position || 0);
  } else if (message.action === 'stop') {
    saveProgress(true);
    generation++;
    disconnect();
    queue = [];
    queueIndex = -1;
    feedUrl = '';
    state = { url: '', name: '', status: 'stopped', error: '' };
    publish();
  } else if (message.action !== 'getPlaybackState') {
    return;
  }
  sendResponse({ state });
});
