// Discover Icecast JSON or ICY metadata for any HTTP/HTTPS stream. No station allowlist.
// Polls disconnect after a title is read; Stop also aborts an outstanding metadata request.
const RadioMetadata = (() => {
  function supported(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch { return false; }
  }

  function trackFromStats(data, streamUrl) {
    const mount = new URL(streamUrl).pathname;
    const raw = data?.icestats?.source;
    const sources = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const source = sources.find((item) => {
      try { return new URL(item.listenurl).pathname === mount; }
      catch { return false; }
    });
    if (!source || typeof source.title !== 'string' || !source.title.trim()) return '';
    const title = source.title.trim();
    const artist = typeof source.artist === 'string' ? source.artist.trim() : '';
    return artist ? `${artist} — ${title}` : title;
  }

  function parseIcyTitle(bytes) {
    // UTF-8 is common; legacy servers may publish Windows-1252 instead.
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('windows-1252').decode(bytes); }
    const match = /(?:^|;)\s*StreamTitle='([\s\S]*?)';/i.exec(text.replace(/\0+$/, ''));
    return match ? match[1].trim() : '';
  }

  async function readIcyTrack(response) {
    const interval = Number(response.headers.get('icy-metaint'));
    if (!Number.isInteger(interval) || interval <= 0 || interval > 1048576) {
      await response.body?.cancel();
      return '';
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    let audioRemaining = interval;
    let metadataRemaining = null;
    let metadata = null;
    let metadataOffset = 0;
    let totalBytes = 0;
    try {
      // A bounded sample, rather than a second permanent audio connection.
      while (totalBytes < 2097152) {
        const { value, done } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        let offset = 0;
        while (offset < value.length) {
          if (audioRemaining > 0) {
            const count = Math.min(audioRemaining, value.length - offset);
            audioRemaining -= count;
            offset += count;
          } else if (metadataRemaining === null) {
            metadataRemaining = value[offset++] * 16;
            metadata = new Uint8Array(metadataRemaining);
            metadataOffset = 0;
            if (metadataRemaining === 0) {
              audioRemaining = interval;
              metadataRemaining = null;
            }
          } else {
            const count = Math.min(metadataRemaining, value.length - offset);
            metadata.set(value.subarray(offset, offset + count), metadataOffset);
            metadataRemaining -= count;
            metadataOffset += count;
            offset += count;
            if (metadataRemaining === 0) {
              const title = parseIcyTitle(metadata);
              if (title) return title;
              audioRemaining = interval;
              metadataRemaining = null;
            }
          }
        }
      }
      return '';
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  const methods = new Map();

  async function requestTrack(url, outerSignal, method) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    outerSignal.addEventListener('abort', cancel, { once: true });
    if (outerSignal.aborted) cancel();
    const timeout = setTimeout(cancel, method === 'json' ? 4000 : 8000);
    try {
      const endpoint = method === 'json' ? new URL('/status-json.xsl', url).href : url;
      const response = await fetch(endpoint, {
        cache: 'no-store', credentials: 'omit', signal: controller.signal,
        ...(method === 'icy' ? { headers: { 'Icy-MetaData': '1' } } : {})
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      return method === 'json' ? trackFromStats(await response.json(), url) : await readIcyTrack(response);
    } finally {
      clearTimeout(timeout);
      outerSignal.removeEventListener('abort', cancel);
    }
  }

  async function fetchTrack(url, signal) {
    const preferred = methods.get(url) || 'json';
    const candidates = [preferred, preferred === 'json' ? 'icy' : 'json'];
    let lastError;
    let answered = false;
    for (const method of candidates) {
      if (signal.aborted) throw new DOMException('Metadata request cancelled', 'AbortError');
      try {
        const track = await requestTrack(url, signal, method);
        answered = true;
        if (track) {
          // Remember the successful format to avoid unnecessary requests on future polls.
          if (methods.size >= 100 && !methods.has(url)) methods.delete(methods.keys().next().value);
          methods.set(url, method);
          return track;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }
    if (!answered && lastError) throw lastError;
    return '';
  }

  function createWatcher(onChange) {
    let currentUrl = '';
    let timer;
    let controller;
    let generation = 0;
    let lastTrack = '';
    let lastTrackTime = 0;

    function stop() {
      generation++;
      currentUrl = '';
      lastTrack = '';
      lastTrackTime = 0;
      clearTimeout(timer);
      controller?.abort();
      controller = null;
    }

    function watch(url) {
      if (url === currentUrl) return;
      stop();
      currentUrl = url;
      if (!url) { onChange(''); return; }
      if (!supported(url)) {
        onChange('Track information requires an HTTP or HTTPS stream URL.');
        return;
      }
      const requestGeneration = generation;
      onChange('Loading track information…');
      async function refresh() {
        const requestController = new AbortController();
        controller = requestController;
        const timeout = setTimeout(() => requestController.abort(), 16000);
        try {
          const track = await fetchTrack(url, requestController.signal);
          if (requestGeneration === generation) {
            if (track) {
              lastTrack = track;
              lastTrackTime = Date.now();
            }
            // ICY blocks can be empty until the title changes. Keep a recent title,
            // but label it stale if several polls fail to confirm it.
            onChange(track ? `Now playing: ${track}`
              : lastTrack && Date.now() - lastTrackTime < 60000 ? `Now playing: ${lastTrack}`
              : 'No track information provided by this station.');
          }
        } catch (error) {
          if (requestGeneration === generation) {
            onChange(lastTrack ? `Last reported: ${lastTrack} (update unavailable)`
              : `Track information unavailable: ${error.name === 'AbortError' ? 'request timed out' : error.message}`);
          }
        } finally {
          clearTimeout(timeout);
          if (requestGeneration === generation) {
            controller = null;
            timer = setTimeout(refresh, 15000);
          }
        }
      }
      refresh();
    }
    return { watch, stop };
  }
  return { supported, trackFromStats, parseIcyTitle, readIcyTrack, fetchTrack, createWatcher };
})();
