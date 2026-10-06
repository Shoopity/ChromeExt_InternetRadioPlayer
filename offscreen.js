chrome.runtime.onMessage.addListener((message) => {
  const player = document.getElementById('audio-player');

  if (message.action === 'startAudio') {
    player.src = message.url;
    player.play().catch((err) => console.error("Playback error:", err));
  } else if (message.action === 'stopAudio') {
    player.pause();
    player.src = '';
  }
});
