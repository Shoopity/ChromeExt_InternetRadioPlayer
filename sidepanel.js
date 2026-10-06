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
      span.addEventListener('click', () => playStation(station.url));

      const delBtn = document.createElement('button');
      delBtn.className = 'del-btn';
      delBtn.textContent = 'X';
      delBtn.addEventListener('click', () => deleteStation(index));

      li.appendChild(span);
      li.appendChild(delBtn);
      stationList.appendChild(li);
    });
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

      // Play direct button
      const playBtn = document.createElement('button');
      playBtn.textContent = '▶';
      playBtn.addEventListener('click', () => playStation(item.url_resolved || item.url));

      // Add to favorites button
      const addFavBtn = document.createElement('button');
      addFavBtn.textContent = '+ Save';
      addFavBtn.addEventListener('click', () => {
        saveStation({ name: item.name, url: item.url_resolved || item.url });
      });

      li.appendChild(nameSpan);
      li.appendChild(playBtn);
      li.appendChild(addFavBtn);
      searchResults.appendChild(li);
    });
  }

  // Send message to background service worker to trigger offscreen audio
  function playStation(streamUrl) {
    chrome.runtime.sendMessage({ action: "play", url: streamUrl });
  }
});
