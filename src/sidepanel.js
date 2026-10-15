document.addEventListener('DOMContentLoaded', () => {
  // Add Custom Station Form Elements
  const nameInput = document.getElementById('nameInput');
  const urlInput = document.getElementById('urlInput');
  const addBtn = document.getElementById('addBtn');
  const stationList = document.getElementById('stationList');

  // Radio Search Elements
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const searchResults = document.getElementById('searchResults');
  const feedUrlInput = document.getElementById('feedUrlInput');
  const loadFeedBtn = document.getElementById('loadFeedBtn');
  const episodeOrder = document.getElementById('episodeOrder');
  const resumePodcastBtn = document.getElementById('resumePodcastBtn');
  const feedStatus = document.getElementById('feedStatus');
  const episodeList = document.getElementById('episodeList');
  const toggleEpisodeListBtn = document.getElementById('toggleEpisodeListBtn');
  const clearFeedBtn = document.getElementById('clearFeedBtn');

  const playbackStatus = document.getElementById('playbackStatus');
  const stopBtn = document.getElementById('stopBtn');
  const nowPlaying = document.getElementById('nowPlaying');
  const metadataWatcher = RadioMetadata.createWatcher((text) => {
    nowPlaying.textContent = text;
  });
  window.addEventListener('pagehide', () => metadataWatcher.stop());
  window.addEventListener('pageshow', () => {
    metadataWatcher.watch(['loading', 'playing'].includes(playback.status) ? playback.url : '');
  });
  let playback = { url: '', name: '', status: 'stopped', error: '' };

  function updatePlayback(state) {
    playback = state;
    const active = ['loading', 'playing'].includes(state.status);
    stopBtn.hidden = !active;
    metadataWatcher.watch(active && state.kind !== 'podcast' ? state.url : '');
    playbackStatus.textContent = state.status === 'error' ? state.error
      : state.status === 'completed' ? 'Podcast playlist finished'
      : state.status === 'playing' ? `Playing${state.kind === 'podcast' ? ` episode ${state.episodeIndex + 1} of ${state.episodeCount}` : ''}: ${state.name}`
      : state.status === 'loading' ? `Connecting: ${state.name}` : 'No station playing';
    document.querySelectorAll('[data-stream-url]').forEach((row) => {
      const selected = active && row.dataset.streamUrl === state.url;
      row.classList.toggle('is-playing', selected && state.status === 'playing');
      row.classList.toggle('is-loading', selected && state.status === 'loading');
      const button = row.querySelector('.play-btn');
      button.textContent = selected ? '■ Stop' : '▶ Play';
      button.setAttribute('aria-label', `${selected ? 'Stop' : 'Play'} ${row.dataset.stationName}`);
      row.querySelector('.equalizer').hidden = !(selected && state.status === 'playing');
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.target === 'panel' && message.action === 'playbackState') updatePlayback(message.state);
  });

  async function command(action, station = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ target: 'background', action, ...station });
      if (response?.error) throw new Error(response.error);
      if (response?.state) updatePlayback(response.state);
    } catch (error) {
      // Keep an active station's Stop control available if communication fails.
      playbackStatus.textContent = `Unable to contact the audio player: ${error.message}`;
    }
  }

  stopBtn.addEventListener('click', () => command('stop'));
  command('getPlaybackState');

  let feedEpisodes = [];
  let activeFeedUrl = '';
  let podcastProgress = null;
  let episodesCollapsed = true;

  function updateEpisodeListVisibility() {
    episodeList.hidden = episodesCollapsed;
    toggleEpisodeListBtn.textContent = `${episodesCollapsed ? 'Show' : 'Hide'} episodes${feedEpisodes.length ? ` (${feedEpisodes.length})` : ''}`;
    toggleEpisodeListBtn.setAttribute('aria-expanded', String(!episodesCollapsed));
  }

  function orderedEpisodes() {
    const episodes = [...feedEpisodes];
    if (episodes.every((episode) => Number.isFinite(Date.parse(episode.published)))) {
      episodes.sort((left, right) => {
        const difference = Date.parse(left.published) - Date.parse(right.published);
        return episodeOrder.value === 'oldest' ? difference : -difference;
      });
    } else if (episodeOrder.value === 'newest') {
      episodes.reverse();
    }
    return episodes;
  }

  function progressEpisode(episodes = orderedEpisodes()) {
    if (!podcastProgress || podcastProgress.feedUrl !== activeFeedUrl) return -1;
    return episodes.findIndex((episode) => episode.id === podcastProgress.episodeId);
  }

  function updateResumeButton(episodes = orderedEpisodes()) {
    const index = progressEpisode(episodes);
    resumePodcastBtn.hidden = index < 0;
    if (index >= 0) resumePodcastBtn.textContent = `Resume: ${episodes[index].title}`;
    Array.from(episodeList.children).forEach((row, episodeIndex) => {
      row.querySelector('button').textContent = episodeIndex === index ? 'Resume' : 'Play';
    });
  }

  function startPodcast(index, position = 0) {
    const episodes = orderedEpisodes();
    if (!episodes[index]) return;
    const savedPosition = progressEpisode(episodes) === index ? (podcastProgress.currentTime || 0) : 0;
    command('playQueue', {
      feedUrl: activeFeedUrl,
      queue: episodes.map(({ id, title, url }) => ({ id, title, url })),
      index,
      position: position || savedPosition
    });
  }

  function renderEpisodes() {
    const episodes = orderedEpisodes();
    episodeList.replaceChildren();
    episodes.forEach((episode, index) => {
      const row = document.createElement('li');
      const details = document.createElement('span');
      details.className = 'episode-details';
      const title = document.createElement('span');
      title.className = 'episode-title';
      title.textContent = episode.title;
      details.appendChild(title);
      if (episode.published) {
        const date = document.createElement('span');
        date.className = 'episode-date';
        date.textContent = new Date(episode.published).toLocaleDateString();
        details.appendChild(date);
      }
      const playButton = document.createElement('button');
      playButton.textContent = progressEpisode(episodes) === index ? 'Resume' : 'Play';
      playButton.addEventListener('click', () => startPodcast(index));
      row.append(details, playButton);
      episodeList.appendChild(row);
    });
    updateResumeButton(episodes);
    updateEpisodeListVisibility();
  }

  function feedChildText(node, name) {
    return Array.from(node.children).find((child) => child.localName === name)?.textContent.trim() || '';
  }

  function parseFeed(xmlText, baseUrl) {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('This URL did not return valid RSS or XML.');
    const items = Array.from(xml.getElementsByTagName('*')).filter((node) => node.localName === 'item');
    const episodes = items.flatMap((item) => {
      const media = Array.from(item.children).find((child) =>
        (child.localName === 'enclosure' && child.hasAttribute('url')) ||
        (child.localName === 'content' && child.hasAttribute('url')) ||
        (child.localName === 'link' && child.getAttribute('rel') === 'enclosure' && child.hasAttribute('href'))
      );
      if (!media) return [];
      const mediaUrl = media.getAttribute('url') || media.getAttribute('href');
      const title = feedChildText(item, 'title') || 'Untitled episode';
      const id = feedChildText(item, 'guid') || mediaUrl;
      return [{ id, title, url: new URL(mediaUrl, baseUrl).href, published: feedChildText(item, 'pubDate') }];
    });
    if (!episodes.length) throw new Error('No playable audio episodes were found in this feed.');
    const channel = Array.from(xml.getElementsByTagName('*')).find((node) => node.localName === 'channel');
    return { title: channel ? feedChildText(channel, 'title') : '', episodes };
  }

  async function loadPodcastFeed(url = feedUrlInput.value.trim()) {
    let feedUrl;
    try {
      feedUrl = new URL(url);
      if (!['http:', 'https:'].includes(feedUrl.protocol)) throw new Error();
    } catch {
      feedStatus.textContent = 'Enter a valid HTTP or HTTPS RSS feed URL.';
      return;
    }
    const normalizedUrl = feedUrl.href;
    loadFeedBtn.disabled = true;
    feedStatus.textContent = 'Loading feed...';
    try {
      const response = await fetch(normalizedUrl);
      if (!response.ok) throw new Error(`Feed request failed (${response.status}).`);
      const parsed = parseFeed(await response.text(), normalizedUrl);
      activeFeedUrl = normalizedUrl;
      feedUrlInput.value = normalizedUrl;
      feedEpisodes = parsed.episodes;
      podcastProgress = (await chrome.storage.local.get('podcastProgress')).podcastProgress || null;
      await chrome.storage.local.set({ podcastFeedUrl: normalizedUrl });
      feedStatus.textContent = `${parsed.title || 'Podcast feed'} · ${feedEpisodes.length} episodes`;
      renderEpisodes();
    } catch (error) {
      feedEpisodes = [];
      episodeList.replaceChildren();
      resumePodcastBtn.hidden = true;
      feedStatus.textContent = `Unable to load feed: ${error.message}`;
    } finally {
      loadFeedBtn.disabled = false;
    }
  }

  loadFeedBtn.addEventListener('click', () => loadPodcastFeed());
  feedUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadPodcastFeed();
  });
  episodeOrder.addEventListener('change', renderEpisodes);
  toggleEpisodeListBtn.addEventListener('click', () => {
    episodesCollapsed = !episodesCollapsed;
    updateEpisodeListVisibility();
    chrome.storage.local.set({ podcastEpisodesCollapsed: episodesCollapsed });
  });
  clearFeedBtn.addEventListener('click', async () => {
    feedEpisodes = [];
    activeFeedUrl = '';
    feedUrlInput.value = '';
    episodeList.replaceChildren();
    resumePodcastBtn.hidden = true;
    feedStatus.textContent = '';
    await chrome.storage.local.remove('podcastFeedUrl');
    updateEpisodeListVisibility();
  });
  resumePodcastBtn.addEventListener('click', () => {
    const index = progressEpisode();
    if (index >= 0) startPodcast(index, podcastProgress.currentTime || 0);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.podcastProgress) {
      podcastProgress = changes.podcastProgress.newValue || null;
      updateResumeButton();
    }
  });
  chrome.storage.local.get(['podcastFeedUrl', 'podcastProgress', 'podcastEpisodesCollapsed']).then((saved) => {
    podcastProgress = saved.podcastProgress || null;
    episodesCollapsed = saved.podcastEpisodesCollapsed !== false;
    updateEpisodeListVisibility();
    if (saved.podcastFeedUrl) {
      feedUrlInput.value = saved.podcastFeedUrl;
      loadPodcastFeed(saved.podcastFeedUrl);
    }
  });

  function playStation(station) {
    nameInput.value = station.name;
    urlInput.value = station.url;
    command('play', station);
  }

  function addPlaybackControls(row, station) {
    row.dataset.streamUrl = station.url;
    row.dataset.stationName = station.name;
    const equalizer = document.createElement('span');
    equalizer.className = 'equalizer';
    equalizer.hidden = true;
    equalizer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) equalizer.appendChild(document.createElement('i'));
    const button = document.createElement('button');
    button.className = 'play-btn';
    button.addEventListener('click', () => {
      const active = ['loading', 'playing'].includes(playback.status) && playback.url === station.url;
      if (active) command('stop');
      else playStation(station);
    });
    row.append(equalizer, button);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.radioStations) loadSavedStations();
  });

  // 1. Initial Load of Saved Stations
  loadSavedStations();

  function loadSavedStations() {
    chrome.storage.sync.get(['radioStations'], (result) => {
      const stations = result.radioStations || [];
      renderSavedStations(stations);
    });
  }

  // 2. Add Custom Station
  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!name || !url) return alert('Please enter both a name and a URL.');

    saveStation({ name, url });
    nameInput.value = '';
    urlInput.value = '';
  });

  // Helper to append a single station to storage
  function saveStation(newStation) {
    chrome.storage.sync.get(['radioStations'], (result) => {
      const stations = result.radioStations || [];
      stations.push(newStation);
      chrome.storage.sync.set({ radioStations: stations }, () => {
        renderSavedStations(stations);
      });
    });
  }

  // 3. Render Saved Custom/Favorite Stations
  function renderSavedStations(stations) {
    stationList.innerHTML = '';
    stations.forEach((station, index) => {
      const li = document.createElement('li');

      const span = document.createElement('span');
      span.className = 'station-name';
      span.textContent = station.name;
      span.title = `Click to play: ${station.url}`;
      span.addEventListener('click', () => playStation(station));

      const delBtn = document.createElement('button');
      delBtn.className = 'del-btn';
      delBtn.textContent = 'X';
      delBtn.addEventListener('click', () => deleteStation(index));

      li.appendChild(span);
      addPlaybackControls(li, station);
      li.appendChild(delBtn);
      stationList.appendChild(li);
    });
    updatePlayback(playback);
  }

  // Delete Station
  function deleteStation(index) {
    chrome.storage.sync.get(['radioStations'], (result) => {
      const stations = result.radioStations || [];
      stations.splice(index, 1);
      chrome.storage.sync.set({ radioStations: stations }, () => {
        renderSavedStations(stations);
      });
    });
  }

  // 4. Search Stations via Radio-Browser API
  searchBtn.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = '<li>Searching...</li>';

    try {
      const response = await fetch(
        `https://de1.api.radio-browser.info/json/stations/byname/${encodeURIComponent(query)}?limit=10`
      );
      const data = await response.json();
      renderSearchResults(data);
    } catch (err) {
      console.error(err);
      searchResults.innerHTML = '<li>Failed to load search results.</li>';
    }
  });

  function renderSearchResults(results) {
    searchResults.innerHTML = '';
    if (results.length === 0) {
      searchResults.innerHTML = '<li>No stations found.</li>';
      return;
    }

    results.forEach((item) => {
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;
      nameSpan.className = 'search-item-name';

      // Add to favorites button
      const addFavBtn = document.createElement('button');
      addFavBtn.textContent = '+ Save';
      addFavBtn.addEventListener('click', () => {
        saveStation({ name: item.name, url: item.url_resolved || item.url });
      });

      li.appendChild(nameSpan);
      addPlaybackControls(li, { name: item.name, url: item.url_resolved || item.url });
      li.appendChild(addFavBtn);
      searchResults.appendChild(li);
    });
    updatePlayback(playback);
  }

});
