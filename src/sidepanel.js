document.addEventListener('DOMContentLoaded', () => {
  // Add Custom Station Form Elements
  const nameInput = document.getElementById('nameInput');
  const urlInput = document.getElementById('urlInput');
  const addBtn = document.getElementById('addBtn');
  const stationList = document.getElementById('stationList');
  const radioSearchServer = document.getElementById('radioSearchServer');

  // Radio Search Elements
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const searchResults = document.getElementById('searchResults');
  const feedUrlInput = document.getElementById('feedUrlInput');
  const loadFeedBtn = document.getElementById('loadFeedBtn');
  const saveFeedBtn = document.getElementById('saveFeedBtn');
  const episodeOrder = document.getElementById('episodeOrder');
  const resumePodcastBtn = document.getElementById('resumePodcastBtn');
  const feedStatus = document.getElementById('feedStatus');
  const episodeList = document.getElementById('episodeList');
  const toggleEpisodeListBtn = document.getElementById('toggleEpisodeListBtn');
  const clearFeedBtn = document.getElementById('clearFeedBtn');
  const savedFeedList = document.getElementById('savedFeedList');
  const feedResultsHome = document.getElementById('feedResultsHome');
  const feedResultsPanel = document.getElementById('feedResultsPanel');
  const syncStatus = document.getElementById('syncStatus');
  const sectionContainer = document.getElementById('sectionContainer');
  const toggleToolsBtn = document.getElementById('toggleToolsBtn');
  const toolsContent = document.getElementById('toolsContent');
  const toggleSearchBtn = document.getElementById('toggleSearchBtn');
  const searchContent = document.getElementById('searchContent');

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
  let activeFeedTitle = '';
  let activeFeedIsSaved = false;
  let podcastProgress = null;
  let episodesCollapsed = true;
  let toolsCollapsed = false;
  let searchCollapsed = false;
  let savedPodcastFeeds = [];

  function updateSectionMoveButtons() {
    const sections = Array.from(sectionContainer.querySelectorAll(':scope > .top-section'));
    sections.forEach((section, index) => {
      section.querySelector('[data-move="up"]').disabled = index === 0;
      section.querySelector('[data-move="down"]').disabled = index === sections.length - 1;
    });
  }

  function applySectionOrder(order = []) {
    const sections = new Map(Array.from(sectionContainer.children, (section) => [section.dataset.sectionId, section]));
    order.forEach((id) => {
      const section = sections.get(id);
      if (section) {
        sectionContainer.appendChild(section);
        sections.delete(id);
      }
    });
    sections.forEach((section) => sectionContainer.appendChild(section));
    updateSectionMoveButtons();
  }

  sectionContainer.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-move]');
    if (!button) return;
    const section = button.closest('.top-section');
    const sections = Array.from(sectionContainer.children);
    const index = sections.indexOf(section);
    const target = sections[index + (button.dataset.move === 'up' ? -1 : 1)];
    if (!target) return;
    if (button.dataset.move === 'up') sectionContainer.insertBefore(section, target);
    else sectionContainer.insertBefore(target, section);
    updateSectionMoveButtons();
    chrome.storage.local.set({
      sidePanelSectionOrder: Array.from(sectionContainer.children, (item) => item.dataset.sectionId)
    }).catch(() => {});
  });

  function updateToolsVisibility() {
    toolsContent.hidden = toolsCollapsed;
    toggleToolsBtn.textContent = toolsCollapsed ? 'Expand' : 'Collapse';
    toggleToolsBtn.setAttribute('aria-expanded', String(!toolsCollapsed));
  }

  function updateSearchVisibility() {
    searchContent.hidden = searchCollapsed;
    toggleSearchBtn.textContent = searchCollapsed ? 'Expand' : 'Collapse';
    toggleSearchBtn.setAttribute('aria-expanded', String(!searchCollapsed));
  }

  function setSyncStatus(detail = '') {
    syncStatus.textContent = `Chrome Sync uses extension ID ${chrome.runtime.id}. ${detail}`;
  }

  function showSyncError(error) {
    setSyncStatus(`Storage error: ${error.message}`);
  }

  function optionalOriginPattern(url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      return `${parsed.protocol}//${parsed.hostname}/*`;
    } catch {
      return '';
    }
  }

  function requestHostPermission(url) {
    const origin = optionalOriginPattern(url);
    return origin ? chrome.permissions.request({ origins: [origin] }) : Promise.resolve(false);
  }

  function hasHostPermission(url) {
    const origin = optionalOriginPattern(url);
    return origin ? chrome.permissions.contains({ origins: [origin] }) : Promise.resolve(false);
  }

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

  function renderSavedFeeds(feeds = savedPodcastFeeds) {
    savedFeedList.replaceChildren();
    activeFeedIsSaved = Boolean(activeFeedUrl && feeds.some((feed) => feed.url === activeFeedUrl));
    let activeFeedFound = false;
    feeds.forEach((feed, index) => {
      const row = document.createElement('li');
      row.className = 'saved-feed-row';
      const controls = document.createElement('div');
      controls.className = 'saved-feed-controls';
      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.className = 'episode-title';
      loadButton.textContent = feed.title || feed.url;
      loadButton.title = feed.url;
      loadButton.addEventListener('click', () => loadPodcastFeed(feed.url));
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'del-btn';
      removeButton.textContent = 'X';
      removeButton.setAttribute('aria-label', `Remove ${feed.title || feed.url}`);
      removeButton.addEventListener('click', () => removeSavedFeed(index));
      controls.append(loadButton, removeButton);
      row.appendChild(controls);
      if (feed.url === activeFeedUrl && activeFeedIsSaved) {
        row.appendChild(feedResultsPanel);
        activeFeedFound = true;
      }
      savedFeedList.appendChild(row);
    });
    if (!activeFeedFound) feedResultsHome.appendChild(feedResultsPanel);
    saveFeedBtn.hidden = !activeFeedUrl || savedPodcastFeeds.some((feed) => feed.url === activeFeedUrl);
  }

  async function savePodcastFeed(feed) {
    try {
      const result = await chrome.storage.sync.get('podcastFeeds');
      const feeds = result.podcastFeeds || [];
      const existingIndex = feeds.findIndex((item) => item.url === feed.url);
      if (existingIndex >= 0) feeds[existingIndex] = feed;
      else feeds.unshift(feed);
      await chrome.storage.sync.set({ podcastFeeds: feeds });
      savedPodcastFeeds = feeds;
      activeFeedIsSaved = activeFeedUrl === feed.url;
      renderSavedFeeds();
      feedStatus.textContent = `${feed.title || feed.url} saved to My Stations.`;
    } catch (error) {
      showSyncError(error);
      feedStatus.textContent += ' Feed loaded, but could not be saved to Chrome Sync.';
    }
  }

  async function removeSavedFeed(index) {
    const feeds = [...savedPodcastFeeds];
    feeds.splice(index, 1);
    try {
      await chrome.storage.sync.set({ podcastFeeds: feeds });
      savedPodcastFeeds = feeds;
      renderSavedFeeds();
      setSyncStatus(`Saved ${feeds.length} podcast feed${feeds.length === 1 ? '' : 's'}.`);
    } catch (error) {
      showSyncError(error);
    }
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

  async function loadPodcastFeed(url = feedUrlInput.value.trim(), requestPermission = true) {
    let feedUrl;
    try {
      feedUrl = new URL(url);
      if (!['http:', 'https:'].includes(feedUrl.protocol)) throw new Error();
    } catch {
      feedStatus.textContent = 'Enter a valid HTTP or HTTPS RSS feed URL.';
      return;
    }
    const normalizedUrl = feedUrl.href;
    activeFeedUrl = '';
    activeFeedTitle = '';
    activeFeedIsSaved = false;
    feedEpisodes = [];
    episodeList.replaceChildren();
    resumePodcastBtn.hidden = true;
    episodesCollapsed = true;
    updateEpisodeListVisibility();
    renderSavedFeeds();
    loadFeedBtn.disabled = true;
    feedStatus.textContent = 'Loading feed...';
    try {
      const granted = requestPermission
        ? await requestHostPermission(normalizedUrl)
        : await hasHostPermission(normalizedUrl);
      if (!granted) {
        feedStatus.textContent = requestPermission
          ? `Access was not granted for ${feedUrl.origin}; the feed was not loaded.`
          : `Click Load Feed to grant access to ${feedUrl.origin}.`;
        return;
      }
      let response;
      try {
        response = await fetch(normalizedUrl);
      } catch {
        throw new Error('The request was blocked or the server could not be reached. Check the URL, network access, and whether it redirects to another host.');
      }
      if (!response.ok) throw new Error(`Feed request failed (${response.status}).`);
      const parsed = parseFeed(await response.text(), normalizedUrl);
      activeFeedUrl = normalizedUrl;
      activeFeedTitle = parsed.title || normalizedUrl;
      feedUrlInput.value = normalizedUrl;
      feedEpisodes = parsed.episodes;
      episodesCollapsed = true;
      await chrome.storage.local.set({ podcastEpisodesCollapsed: true });
      podcastProgress = (await chrome.storage.local.get('podcastProgress')).podcastProgress || null;
      await chrome.storage.local.set({ podcastFeedUrl: normalizedUrl });
      feedStatus.textContent = `${parsed.title || 'Podcast feed'} · ${feedEpisodes.length} episodes`;
      renderEpisodes();
      renderSavedFeeds();
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
  feedUrlInput.addEventListener('input', () => {
    if (feedUrlInput.value.trim() !== activeFeedUrl) saveFeedBtn.hidden = true;
  });
  feedUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loadPodcastFeed();
  });
  saveFeedBtn.addEventListener('click', () => {
    if (activeFeedUrl) savePodcastFeed({ title: activeFeedTitle, url: activeFeedUrl });
  });
  episodeOrder.addEventListener('change', renderEpisodes);
  toggleToolsBtn.addEventListener('click', () => {
    toolsCollapsed = !toolsCollapsed;
    updateToolsVisibility();
    chrome.storage.local.set({ sidePanelToolsCollapsed: toolsCollapsed }).catch(() => {});
  });
  toggleSearchBtn.addEventListener('click', () => {
    searchCollapsed = !searchCollapsed;
    updateSearchVisibility();
    chrome.storage.local.set({ sidePanelSearchCollapsed: searchCollapsed }).catch(() => {});
  });
  toggleEpisodeListBtn.addEventListener('click', () => {
    episodesCollapsed = !episodesCollapsed;
    updateEpisodeListVisibility();
    chrome.storage.local.set({ podcastEpisodesCollapsed: episodesCollapsed });
  });
  clearFeedBtn.addEventListener('click', async () => {
    feedEpisodes = [];
    activeFeedUrl = '';
    activeFeedTitle = '';
    activeFeedIsSaved = false;
    feedUrlInput.value = '';
    episodeList.replaceChildren();
    resumePodcastBtn.hidden = true;
    feedStatus.textContent = '';
    await chrome.storage.local.remove('podcastFeedUrl');
    renderSavedFeeds();
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
    if (area === 'sync' && changes.podcastFeeds) {
      savedPodcastFeeds = changes.podcastFeeds.newValue || [];
      renderSavedFeeds();
    }
  });
  chrome.storage.local.get([
    'podcastFeedUrl', 'podcastProgress', 'podcastEpisodesCollapsed',
    'sidePanelSectionOrder', 'sidePanelToolsCollapsed', 'sidePanelSearchCollapsed', 'radioSearchServer'
  ]).then((saved) => {
    podcastProgress = saved.podcastProgress || null;
    episodesCollapsed = saved.podcastEpisodesCollapsed !== false;
    toolsCollapsed = saved.sidePanelToolsCollapsed === true;
    searchCollapsed = saved.sidePanelSearchCollapsed === true;
    if (['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info'].includes(saved.radioSearchServer)) {
      radioSearchServer.value = saved.radioSearchServer;
    }
    applySectionOrder(saved.sidePanelSectionOrder || []);
    updateToolsVisibility();
    updateSearchVisibility();
    updateEpisodeListVisibility();
    if (saved.podcastFeedUrl) {
      feedUrlInput.value = saved.podcastFeedUrl;
      loadPodcastFeed(saved.podcastFeedUrl, false);
    }
  });
  chrome.storage.sync.get(['podcastFeeds']).then((saved) => {
    savedPodcastFeeds = saved.podcastFeeds || [];
    renderSavedFeeds();
  }).catch(showSyncError);

  function playStation(station) {
    nameInput.value = station.name;
    urlInput.value = station.url;
    command('play', station);
    requestHostPermission(station.url).then((granted) => {
      if (playback.url !== station.url || !['loading', 'playing'].includes(playback.status)) return;
      if (granted) {
        metadataWatcher.watch('');
        metadataWatcher.watch(station.url);
      } else {
        nowPlaying.textContent = 'Grant site access to read track information; audio playback can continue.';
      }
    }).catch(() => {});
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
    chrome.storage.sync.get(['radioStations']).then((result) => {
      const stations = result.radioStations || [];
      renderSavedStations(stations);
      setSyncStatus(`Loaded ${stations.length} station${stations.length === 1 ? '' : 's'}.`);
    }).catch(showSyncError);
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
  async function saveStation(newStation) {
    let metadataAccess = false;
    try {
      metadataAccess = await requestHostPermission(newStation.url);
    } catch {
      metadataAccess = false;
    }
    chrome.storage.sync.get(['radioStations']).then((result) => {
      const stations = result.radioStations || [];
      stations.push(newStation);
      return chrome.storage.sync.set({ radioStations: stations }).then(() => {
        renderSavedStations(stations);
        const accessMessage = metadataAccess
          ? ''
          : ' Site access was not granted; audio can play, but track information may be unavailable.';
        setSyncStatus(`Saved ${stations.length} station${stations.length === 1 ? '' : 's'}.${accessMessage}`);
      });
    }).catch(showSyncError);
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
    chrome.storage.sync.get(['radioStations']).then((result) => {
      const stations = result.radioStations || [];
      stations.splice(index, 1);
      return chrome.storage.sync.set({ radioStations: stations }).then(() => {
        renderSavedStations(stations);
      });
    }).catch(showSyncError);
  }

  // 4. Search Stations via Radio-Browser API
  searchBtn.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) return;

    searchResults.innerHTML = '<li>Searching...</li>';

    try {
      await chrome.storage.local.set({ radioSearchServer: radioSearchServer.value });
      const response = await fetch(`${radioSearchServer.value}/json/stations/byname/${encodeURIComponent(query)}?limit=10`);
      if (!response.ok) throw new Error(`Search request failed (${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('The station directory returned an unexpected response.');
      renderSearchResults(data);
    } catch (err) {
      console.error(err);
      searchResults.replaceChildren();
      const message = document.createElement('li');
      message.textContent = `Search failed: ${err.message}`;
      searchResults.appendChild(message);
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
