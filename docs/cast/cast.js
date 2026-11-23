const params = new URLSearchParams(window.location.search);
const stationUrl = params.get('url') || '';
const stationName = params.get('name') || 'Internet Radio';
const extensionId = params.get('extensionId') || '';
const stationKind = params.get('kind') || 'live';
const status = document.getElementById('status');
const station = document.getElementById('station');
const castHelp = document.getElementById('castHelp');
let castInitialized = false;
let pickerRequested = false;

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

station.textContent = stationUrl && isHttpUrl(stationUrl)
  ? `Ready to cast: ${stationName}`
  : 'Open this page from the radio player after selecting a station.';

function onCastApiAvailable(available) {
  if (!available) {
    status.textContent = 'Google Cast is unavailable in this browser.';
    showLauncherFallback();
    return;
  }
  initializeCast();
}

function showLauncherFallback() {
  const prompt = document.getElementById('pickerPrompt');
  const launcher = document.getElementById('castLauncher');
  if (prompt) prompt.textContent = 'Select the Cast icon to choose a speaker.';
  if (launcher) launcher.hidden = false;
}

window.addEventListener('cast-api-available', () => onCastApiAvailable(window.castApiAvailable));
if (typeof window.castApiAvailable === 'boolean') onCastApiAvailable(window.castApiAvailable);

function initializeCast() {
  if (castInitialized) return;
  castInitialized = true;
  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });
  context.addEventListener(
    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    onSessionStateChanged
  );
  status.textContent = stationUrl && isHttpUrl(stationUrl)
    ? 'Opening the local Cast device picker.'
    : 'No playable station was provided by the radio player.';
  requestCastSession();
}

async function requestCastSession() {
  if (pickerRequested || !stationUrl || !isHttpUrl(stationUrl)) return;
  pickerRequested = true;
  const prompt = document.getElementById('pickerPrompt');
  const context = cast.framework.CastContext.getInstance();
  const existingSession = context.getCurrentSession();
  if (existingSession) {
    await loadStation(existingSession);
    return;
  }
  const fallbackTimer = window.setTimeout(() => {
    showLauncherFallback();
  }, 1500);
  try {
    await context.requestSession();
    window.clearTimeout(fallbackTimer);
  } catch (error) {
    window.clearTimeout(fallbackTimer);
    pickerRequested = false;
    showLauncherFallback();
    status.textContent = `Automatic device selection was unavailable: ${error.message || error}`;
  }
}

async function onSessionStateChanged(event) {
  if (event.sessionState === cast.framework.SessionState.SESSION_ENDED) {
    status.textContent = 'The Cast session has ended.';
    if (castHelp) castHelp.hidden = true;
    await notifyCastState(false).catch(() => {});
    return;
  }
  if (event.sessionState !== cast.framework.SessionState.SESSION_STARTED &&
      event.sessionState !== cast.framework.SessionState.SESSION_RESUMED) return;
  await loadStation(event.session);
}

async function loadStation(session) {
  if (!isHttpUrl(stationUrl)) {
    status.textContent = 'No valid station URL was provided. Close this tab and try again from the player.';
    return;
  }

  try {
    const mediaInfo = new chrome.cast.media.MediaInfo(stationUrl, getContentType(stationUrl));
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = stationName;
    mediaInfo.metadata.artist = 'Internet Radio';
    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = 0;
    request.autoplay = true;
    if (stationKind === 'live') {
      mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
    }
    await session.loadMedia(request);
    status.textContent = `Casting ${stationName}. Use the speaker or this browser to control playback.`;
    if (castHelp) castHelp.hidden = false;
    await notifyCastState(true);
    await pauseLocalPlayer();
    window.setTimeout(() => window.close(), 300);
  } catch (error) {
    status.textContent = `Could not start this stream on the speaker: ${error.message}`;
  }
}

async function notifyCastState(active) {
  if (!extensionId || !chrome.runtime?.sendMessage) return;
  const response = await chrome.runtime.sendMessage(extensionId, {
    action: 'castState',
    active
  });
  if (response?.error) throw new Error(response.error);
}

function getContentType(value) {
  const path = new URL(value).pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.aac')) return 'audio/aac';
  if (path.endsWith('.ogg') || path.endsWith('.oga')) return 'audio/ogg';
  if (path.endsWith('.wav')) return 'audio/wav';
  return 'audio/mpeg';
}

async function pauseLocalPlayer() {
  if (!extensionId || !chrome.runtime?.sendMessage) return;
  const response = await chrome.runtime.sendMessage(extensionId, { action: 'pauseLocalForCast' });
  if (response?.error) throw new Error(response.error);
}
