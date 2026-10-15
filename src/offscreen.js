const player = document.getElementById('audio-player');
let state = { url: '', name: '', status: 'stopped', error: '' };
let generation = 0;

function publish() {
  chrome.runtime.sendMessage({ target: 'panel', action: 'playbackState', state })
    .catch(() => {}); // Playback also works while no panel is open.
}

function disconnect() {
  player.pause();
  player.removeAttribute('src');
  player.load(); // Abort the request and discard buffered audio.
}

function fail(message) {
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
for (const event of ['waiting', 'stalled']) {
  player.addEventListener(event, () => {
    if (!state.url || !player.hasAttribute('src') || state.status === 'error') return;
    state = { ...state, status: 'loading' };
    publish();
  });
}
player.addEventListener('error', () => {
  if (player.error && state.url && player.hasAttribute('src')) {
    fail('Unable to play this stream. Check the URL or try another station.');
  }
});
player.addEventListener('ended', () => {
  if (state.url && player.ended) fail('The stream ended. Click Play to reconnect.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  if (message.action === 'play') {
    const request = ++generation;
    disconnect();
    state = { url: message.url, name: message.name || 'Radio station', status: 'loading', error: '' };
    player.src = message.url;
    publish();
    // Do not await play: Stop must work even while a stream is connecting.
    player.play().catch((error) => {
      if (request === generation && state.status !== 'error') {
        fail(`Playback failed: ${error.message}`);
      }
    });
  } else if (message.action === 'stop') {
    generation++;
    disconnect();
    state = { url: '', name: '', status: 'stopped', error: '' };
    publish();
  } else if (message.action !== 'getPlaybackState') {
    return;
  }
  sendResponse({ state });
});
