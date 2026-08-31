document.addEventListener('DOMContentLoaded', () => {

  const searchSection = document.getElementById('search-section');
  const statusSection = document.getElementById('status-section');
  const errorSection = document.getElementById('error-section');
  const resultSection = document.getElementById('result-section');
  const photoResultSection = document.getElementById('photo-result-section');
  const photoGrid = document.getElementById('photo-grid');
  const photoSelectionText = document.getElementById('photo-selection-text');
  const btnSelectAllPhotos = document.getElementById('btn-select-all-photos');
  const btnClearSelection = document.getElementById('btn-clear-selection');
  const btnDownloadPhotos = document.getElementById('btn-download-photos');
  const btnResetPhotos = document.getElementById('btn-reset-photos');

  const form = document.getElementById('downloader-form');
  const tiktokUrlInput = document.getElementById('tiktok-url');
  const btnPaste = document.getElementById('btn-paste');
  const btnDownload = document.getElementById('btn-download');
  const btnCloseError = document.getElementById('btn-close-error');

  const statusMessage = document.getElementById('status-message');
  const errorMessage = document.getElementById('error-message');

  const resultTitle = document.getElementById('result-title');
  const resultQuality = document.getElementById('result-quality');
  const videoPreview = document.getElementById('video-preview');
  const btnFileDownload = document.getElementById('btn-file-download');
  const btnReset = document.getElementById('btn-reset');

  let statusInterval = null;
  let photoState = { url: '', photos: [], selected: new Set() };

  btnPaste.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard) {
        showError('Your browser does not support automatic clipboard pasting. Please paste manually.');
        return;
      }

      const text = await navigator.clipboard.readText();
      if (text) {
        tiktokUrlInput.value = text.trim();
        hideError();
      }
    } catch (err) {
      console.warn('Clipboard read failed:', err);
      showError('Clipboard access denied. Please paste the link manually.');
    }
  });

  btnCloseError.addEventListener('click', hideError);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = tiktokUrlInput.value.trim();

    if (!url) {
      showError('Please paste a TikTok URL first.');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      showError('Invalid link. TikTok links must start with http:// or https://');
      return;
    }

    if (!url.includes('tiktok.com')) {
      showError('Please enter a valid TikTok URL (e.g. vm.tiktok.com/... or tiktok.com/@username/video/...)');
      return;
    }

    hideError();
    toggleSection(searchSection, false);
    toggleSection(statusSection, true);

    startStatusRotation();

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
      });

      const data = await response.json();

      stopStatusRotation();

      if (response.ok && data.success && data.type === 'photo') {
        renderPhotoPost(data, url);
        toggleSection(statusSection, false);
        toggleSection(photoResultSection, true);
        return;
      }

      if (response.ok && data.success) {

        resultTitle.textContent = data.title || 'TikTok Video';
        resultQuality.textContent = data.quality || 'HD';

        if (data.author) {
          document.getElementById('author-avatar').src = data.author.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.author.nickname || 'User') + '&background=000&color=fff';
          document.getElementById('author-nickname').textContent = data.author.nickname || 'Unknown User';
          document.getElementById('author-username').textContent = '@' + (data.author.unique_id || 'user');
        }

        const formatStat = (num) => {
          if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
          if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
          return num;
        };

        if (data.stats) {
          document.getElementById('stat-plays').textContent = formatStat(data.stats.plays || 0);
          document.getElementById('stat-likes').textContent = formatStat(data.stats.likes || 0);
          document.getElementById('stat-comments').textContent = formatStat(data.stats.comments || 0);
          document.getElementById('stat-shares').textContent = formatStat(data.stats.shares || 0);
        }

        videoPreview.src = data.downloadUrl;
        btnFileDownload.href = data.downloadUrl;

        toggleSection(statusSection, false);
        toggleSection(resultSection, true);
        videoPreview.load(); 
      } else {

        showError(data.error || 'Unable to process this TikTok post.');
        toggleSection(statusSection, false);
        toggleSection(searchSection, true);
      }

    } catch (err) {
      console.error('Fetch error:', err);
      stopStatusRotation();
      showError('A network error occurred. Please check your internet connection and try again.');
      toggleSection(statusSection, false);
      toggleSection(searchSection, true);
    }
  });

  btnReset.addEventListener('click', () => {
    resetResults();
  });

  btnResetPhotos.addEventListener('click', resetResults);

  btnSelectAllPhotos.addEventListener('click', () => {
    photoState.selected = new Set(photoState.photos.map((photo) => photo.index));
    updatePhotoSelection();
  });

  btnClearSelection.addEventListener('click', () => {
    photoState.selected.clear();
    updatePhotoSelection();
  });

  btnDownloadPhotos.addEventListener('click', async () => {
    if (photoState.selected.size === 0) {
      showError('Select at least one photo to download.');
      return;
    }

    btnDownloadPhotos.disabled = true;
    btnDownloadPhotos.textContent = 'Preparing download...';
    try {
      const response = await fetch('/api/photos/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: photoState.url,
          selection: Array.from(photoState.selected).sort((a, b) => a - b)
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Photo download failed.');
      }
      window.location.href = response.url;
    } catch (error) {
      showError(error.message || 'Couldn’t download the selected photos.');
    } finally {
      btnDownloadPhotos.disabled = false;
      btnDownloadPhotos.innerHTML = '<svg class="icon-download" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg> Download Selected';
    }
  });

  function resetResults() {

    videoPreview.pause();
    videoPreview.removeAttribute('src');
    videoPreview.load();

    tiktokUrlInput.value = '';
    toggleSection(resultSection, false);
    toggleSection(photoResultSection, false);
    toggleSection(searchSection, true);
    hideError();
    photoState = { url: '', photos: [], selected: new Set() };
    photoGrid.replaceChildren();
  }

  function renderPhotoPost(data, sourceUrl) {
    photoState = { url: sourceUrl, photos: data.photos || [], selected: new Set() };
    document.getElementById('photo-result-title').textContent = data.title || 'TikTok Photo Post';
    document.getElementById('photo-count-badge').textContent = `${photoState.photos.length} photos`;
    document.getElementById('photo-author-avatar').src = data.author?.avatar || 'https://ui-avatars.com/api/?name=User&background=000&color=fff';
    document.getElementById('photo-author-nickname').textContent = data.author?.displayName || 'Unknown User';
    document.getElementById('photo-author-username').textContent = data.author?.username || '@user';
    photoGrid.replaceChildren();

    photoState.photos.forEach((photo) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'photo-tile';
      button.dataset.index = photo.index;
      button.setAttribute('aria-label', `Select photo ${photo.index}`);
      button.innerHTML = `<img src="${photo.url}" alt="Photo ${photo.index}" loading="lazy"><span>Photo ${photo.index}</span>`;
      button.addEventListener('click', () => {
        if (photoState.selected.has(photo.index)) photoState.selected.delete(photo.index);
        else photoState.selected.add(photo.index);
        updatePhotoSelection();
      });
      photoGrid.appendChild(button);
    });
    updatePhotoSelection();
  }

  function updatePhotoSelection() {
    photoGrid.querySelectorAll('.photo-tile').forEach((tile) => {
      const selected = photoState.selected.has(Number(tile.dataset.index));
      tile.classList.toggle('selected', selected);
      tile.setAttribute('aria-pressed', String(selected));
    });
    const count = photoState.selected.size;
    photoSelectionText.textContent = `${count} photo${count === 1 ? '' : 's'} selected`;
    btnDownloadPhotos.disabled = count === 0;
    btnSelectAllPhotos.textContent = count === photoState.photos.length && count > 0 ? 'All Selected' : 'Select All';
  }

  function toggleSection(element, show) {
    if (show) {
      element.classList.remove('hidden');
    } else {
      element.classList.add('hidden');
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorSection.classList.remove('hidden');
    errorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    errorSection.classList.add('hidden');
  }

  function startStatusRotation() {
    const statuses = [
      'Validating TikTok link...',
      'Connecting to retrieval provider...',
      'Detecting video or photo post...',
      'Preparing a secure download link...',
      'Almost done...'
    ];
    let index = 0;
    statusMessage.textContent = statuses[index];

    statusInterval = setInterval(() => {
      index = (index + 1) % statuses.length;
      statusMessage.textContent = statuses[index];
    }, 2000);
  }

  function stopStatusRotation() {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  }
});
