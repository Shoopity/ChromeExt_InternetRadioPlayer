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
    metadataWatcher.watch(active ? state.url : "");
    playbackStatus.textContent = state.status === 'error' ? state.error
      : state.status === 'playing' ? `Playing: ${state.name}`
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
