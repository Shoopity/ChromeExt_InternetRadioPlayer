const player = document.getElementById('audio-player');
let state = { url: '', name: '', status: 'stopped', error: '' };
let generation = 0;
let queue = [];
let queueIndex = -1;
let feedUrl = '';
let pendingSeek = null;
let lastProgressWrite = 0;

function playbackSnapshot() {
  return { ...state, queue: [...queue], queueIndex, feedUrl };
}

function publish(persist = false) {
  const snapshot = playbackSnapshot();
  chrome.runtime.sendMessage({ target: 'panel', action: 'playbackState', state: snapshot })
    .catch(() => {}); // Playback also works while no panel is open.
  if (persist) {
    chrome.runtime.sendMessage({ target: 'background', action: 'saveLastPlayback', playback: snapshot })
      .catch(() => {});
  }
}

function updateTimeline(persist = false) {
  if (!player.hasAttribute('src')) return;
  const ranges = player.seekable;
  const hasSeekableRange = ranges.length > 0;
  const rangeIndex = hasSeekableRange ? ranges.length - 1 : -1;
  const duration = Number.isFinite(player.duration) ? player.duration : null;
  const podcastIsSeekable = state.kind === 'podcast' && duration > 0 && ranges.length === 1 &&
    ranges.start(0) <= 0.5 && ranges.end(0) >= duration - 0.5;
  state = {
    ...state,
    currentTime: Number.isFinite(player.currentTime) ? player.currentTime : state.currentTime || 0,
    duration,
    seekableStart: hasSeekableRange ? ranges.start(rangeIndex) : null,
    seekableEnd: hasSeekableRange ? ranges.end(rangeIndex) : null,
    canSeek: state.kind === 'live' ? hasSeekableRange : podcastIsSeekable
  };
  publish(persist);
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
    currentTime: position,
    duration: null,
    seekableStart: null,
    seekableEnd: null,
    canSeek: false
  };
  saveProgress(true, position);
  player.crossOrigin = 'anonymous';
  player.src = episode.url;
  publish(true);
  player.play().catch((error) => {
    if (request === generation && state.status !== 'error') {
      fail(`Playback failed: ${error.message}`);
    }
  });
}

function startLive(url, name) {
  const request = ++generation;
  disconnect();
  queue = [];
  queueIndex = -1;
  feedUrl = '';
  state = {
    url,
    name: name || 'Radio station',
    status: 'loading',
    error: '',
    kind: 'live',
    currentTime: 0,
    duration: null,
    seekableStart: null,
    seekableEnd: null,
    canSeek: false
  };
  player.removeAttribute('crossorigin');
  player.src = url;
  publish(true);
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
  updateTimeline(true);
});
player.addEventListener('loadedmetadata', () => {
  if (pendingSeek !== null && player.hasAttribute('src')) {
    try {
      player.currentTime = pendingSeek;
    } catch (error) {
      console.warn('Unable to restore podcast position:', error);
    }
    pendingSeek = null;
  }
  updateTimeline();
});
player.addEventListener('timeupdate', () => {
  updateTimeline();
  if (queueIndex >= 0) saveProgress();
});
for (const event of ['durationchange', 'progress', 'seeked']) {
  player.addEventListener(event, () => updateTimeline());
}
for (const event of ['waiting', 'stalled']) {
  player.addEventListener(event, () => {
    if (!state.url || !player.hasAttribute('src') || state.status === 'error') return;
    state = { ...state, status: 'loading' };
    publish(true);
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
      publish(true);
    }
    return;
  }
  fail('The stream ended. Click Play to reconnect.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  if (message.action === 'play') {
    saveProgress(true);
    startLive(message.url, message.name);
  } else if (message.action === 'playQueue') {
    if (!Array.isArray(message.queue) || !message.queue.length || !message.feedUrl) {
      sendResponse({ error: 'The podcast feed has no playable episodes.' });
      return;
    }
    feedUrl = message.feedUrl;
    queue = message.queue;
    startEpisode(message.index || 0, message.position || 0);
  } else if (message.action === 'seek') {
    const target = Number(message.currentTime);
    if (!Number.isFinite(target) || !state.canSeek || !player.hasAttribute('src')) {
      sendResponse({ state: playbackSnapshot(), error: 'Seeking is not available for this media.' });
      return;
    }
    const minimum = state.kind === 'live' ? state.seekableStart : 0;
    const maximum = state.kind === 'live' ? state.seekableEnd : state.duration;
    try {
      player.currentTime = Math.max(minimum, Math.min(maximum, target));
      updateTimeline(true);
    } catch {
      state = { ...state, canSeek: false };
      publish(true);
    }
  } else if (message.action === 'goLive') {
    if (state.kind === 'live' && state.canSeek && player.hasAttribute('src')) {
      try {
        player.currentTime = state.seekableEnd;
        updateTimeline(true);
      } catch {
        state = { ...state, canSeek: false };
        publish(true);
      }
    }
  } else if (message.action === 'resume') {
    if (!state.url && message.playback?.url) {
      state = message.playback;
      queue = Array.isArray(message.playback.queue) ? message.playback.queue : [];
      queueIndex = Number.isInteger(message.playback.queueIndex) ? message.playback.queueIndex : -1;
      feedUrl = message.playback.feedUrl || '';
    }
    if (state.kind === 'podcast' && queueIndex >= 0) {
      startEpisode(queueIndex, state.currentTime || 0);
    } else if (state.url) {
      startLive(state.url, state.name);
    }
  } else if (message.action === 'stop') {
    const position = Number.isFinite(player.currentTime) ? player.currentTime : state.currentTime || 0;
    saveProgress(true, position);
    generation++;
    disconnect();
    state = { ...state, status: 'stopped', error: '', currentTime: position };
    publish(true);
  } else if (message.action !== 'getPlaybackState') {
    return;
  }
  sendResponse({ state: playbackSnapshot() });
});
