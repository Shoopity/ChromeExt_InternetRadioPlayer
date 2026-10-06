document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('nameInput');
  const urlInput = document.getElementById('urlInput');
  const addBtn = document.getElementById('addBtn');
  const stationList = document.getElementById('stationList');

  // Load existing synced stations when popup opens
  chrome.storage.sync.get(['radioStations'], (result) => {
    const stations = result.radioStations || [];
    renderStations(stations);
  });

  // Add station and sync to Google Account
  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!name || !url) return alert('Please enter both a name and a URL.');

    chrome.storage.sync.get(['radioStations'], (result) => {
      const stations = result.radioStations || [];
      stations.push({ name, url });

      chrome.storage.sync.set({ radioStations: stations }, () => {
        renderStations(stations);
        nameInput.value = '';
        urlInput.value = '';
      });
    });
  });

  // Render list items to the UI
  function renderStations(stations) {
    stationList.innerHTML = '';
    stations.forEach((station, index) => {
      const li = document.createElement('li');
      
      const span = document.createElement('span');
      span.className = 'station-name';
      span.textContent = station.name;
      span.title = `Click to listen: ${station.url}`;
      // Open stream directly in a new tab to play it seamlessly
      span.addEventListener('click', () => window.open(station.url, '_blank'));

      const delBtn = document.createElement('button');
      delBtn.className = 'del-btn';
      delBtn.textContent = 'X';
      delBtn.addEventListener('click', () => deleteStation(index));

      li.appendChild(span);
      li.appendChild(delBtn);
      stationList.appendChild(li);
    });
  }

  // Delete station and update cloud sync
  function deleteStation(index) {
    chrome.storage.sync.get(['radioStations'], (result) => {
      const stations = result.radioStations || [];
      stations.splice(index, 1);
      chrome.storage.sync.set({ radioStations: stations }, () => {
        renderStations(stations);
      });
    });
  }
});
