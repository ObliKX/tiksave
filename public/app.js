document.addEventListener('DOMContentLoaded', () => {

  const searchSection = document.getElementById('search-section');
  const statusSection = document.getElementById('status-section');
  const errorSection = document.getElementById('error-section');
  const resultSection = document.getElementById('result-section');
  const photoResultSection = document.getElementById('photo-result-section');

  const form = document.getElementById('downloader-form');
  const tiktokUrlInput = document.getElementById('tiktok-url');
  const btnPaste = document.getElementById('btn-paste');
  const btnDownload = document.getElementById('btn-download');
  const btnCloseError = document.getElementById('btn-close-error');

  const statusMessage = document.getElementById('status-message');
  const errorMessage = document.getElementById('error-message');

  // Video elements
  const resultTitle = document.getElementById('result-title');
  const resultQuality = document.getElementById('result-quality');
  const videoPreview = document.getElementById('video-preview');
  const btnFileDownload = document.getElementById('btn-file-download');
  const btnReset = document.getElementById('btn-reset');

  // Photo elements
  const photoGrid = document.getElementById('photo-grid');
  const btnSelectAllPhotos = document.getElementById('btn-select-all-photos');
  const btnClearSelection = document.getElementById('btn-clear-selection');
  const btnDownloadPhotos = document.getElementById('btn-download-photos');
  const btnResetPhotos = document.getElementById('btn-reset-photos');
  const photoSelectionText = document.getElementById('photo-selection-text');
  const photoCountBadge = document.getElementById('photo-count-badge');
  const photoResultTitle = document.getElementById('photo-result-title');

  let statusInterval = null;
  let currentPhotoSelection = new Set();
  let currentPhotoUrl = '';
  let currentPhotoData = null;

  const formatStat = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num;
  };

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
      showError('Please paste a TikTok video or photo link first.');
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
      // Try to detect what type of post this is (photo vs video)
      let postType = 'video'; // default
      
      try {
        const photoResponse = await fetch('/api/photos/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });

        if (photoResponse.ok) {
          const photoData = await photoResponse.json();
          if (photoData.success && photoData.type === 'photo') {
            // It's definitely a photo post
            stopStatusRotation();
            displayPhotoPost(url, photoData);
            return;
          }
        }
      } catch (photoErr) {
        // Photo detection failed, fall through to video
        console.log('Photo detection failed, trying video...');
      }

      // No photos found, try video
      const videoResponse = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
      });

      const videoData = await videoResponse.json();
      stopStatusRotation();

      if (videoResponse.ok && videoData.success) {
        // It's a video
        resultTitle.textContent = videoData.title || 'TikTok Video';
        resultQuality.textContent = videoData.quality || 'HD';

        if (videoData.author) {
          document.getElementById('author-avatar').src = videoData.author.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(videoData.author.nickname || 'User') + '&background=000&color=fff';
          document.getElementById('author-nickname').textContent = videoData.author.nickname || 'Unknown User';
          document.getElementById('author-username').textContent = '@' + (videoData.author.unique_id || 'user');
        }

        if (videoData.stats) {
          document.getElementById('stat-plays').textContent = formatStat(videoData.stats.plays || 0);
          document.getElementById('stat-likes').textContent = formatStat(videoData.stats.likes || 0);
          document.getElementById('stat-comments').textContent = formatStat(videoData.stats.comments || 0);
          document.getElementById('stat-shares').textContent = formatStat(videoData.stats.shares || 0);
        }

        videoPreview.src = videoData.downloadUrl;
        btnFileDownload.href = videoData.downloadUrl;

        toggleSection(statusSection, false);
        toggleSection(resultSection, true);
        videoPreview.load();
      } else {
        // Both photo and video detection failed
        showError(videoData.error || 'Unable to process this link. Please verify it\'s a valid TikTok video or photo post.');
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

  /**
   * Display a photo post with selector UI
   */
  function displayPhotoPost(url, photoData) {
    currentPhotoUrl = url;
    currentPhotoData = photoData;
    currentPhotoSelection.clear();

    // Set header info
    photoResultTitle.textContent = photoData.title || 'TikTok Photo Post';
    photoCountBadge.textContent = `${photoData.count} photo${photoData.count !== 1 ? 's' : ''}`;

    if (photoData.author) {
      document.getElementById('photo-author-avatar').src = photoData.author.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(photoData.author.nickname || 'User') + '&background=000&color=fff';
      document.getElementById('photo-author-nickname').textContent = photoData.author.nickname || 'Unknown User';
      document.getElementById('photo-author-username').textContent = '@' + (photoData.author.unique_id || 'user');
    }

    if (photoData.stats) {
      document.getElementById('photo-stat-likes').textContent = formatStat(photoData.stats.likes || 0);
      document.getElementById('photo-stat-comments').textContent = formatStat(photoData.stats.comments || 0);
      document.getElementById('photo-stat-shares').textContent = formatStat(photoData.stats.shares || 0);
    }

    // Build photo grid
    photoGrid.innerHTML = '';
    photoData.photos.forEach((photo) => {
      const photoTile = document.createElement('div');
      photoTile.className = 'photo-tile';
      photoTile.innerHTML = `
        <div class="photo-image">
          <img src="${photo.url}" alt="Photo ${photo.index}" loading="lazy">
        </div>
        <div class="photo-index">${photo.index}</div>
        <input type="checkbox" class="photo-checkbox" data-index="${photo.index}" aria-label="Select photo ${photo.index}">
      `;

      const checkbox = photoTile.querySelector('.photo-checkbox');
      photoTile.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        updatePhotoSelection();
      });

      checkbox.addEventListener('change', updatePhotoSelection);

      photoGrid.appendChild(photoTile);
    });

    toggleSection(statusSection, false);
    toggleSection(photoResultSection, true);
    photoResultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Update photo selection UI and tracking
   */
  function updatePhotoSelection() {
    currentPhotoSelection.clear();
    const checkboxes = photoGrid.querySelectorAll('input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
      currentPhotoSelection.add(parseInt(cb.dataset.index, 10));
    });

    const count = currentPhotoSelection.size;
    photoSelectionText.textContent = `${count} photo${count !== 1 ? 's' : ''} selected`;
    
    btnDownloadPhotos.disabled = count === 0;
    btnDownloadPhotos.textContent = count > 0
      ? `Download Selected (${count})`
      : 'Download Selected';
  }

  btnSelectAllPhotos.addEventListener('click', () => {
    photoGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = true;
    });
    updatePhotoSelection();
  });

  btnClearSelection.addEventListener('click', () => {
    photoGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
    });
    updatePhotoSelection();
  });

  btnDownloadPhotos.addEventListener('click', async () => {
    if (currentPhotoSelection.size === 0) {
      showError('Please select at least one photo.');
      return;
    }

    toggleSection(photoResultSection, false);
    toggleSection(statusSection, true);
    statusMessage.textContent = `Downloading ${currentPhotoSelection.size} photo${currentPhotoSelection.size !== 1 ? 's' : ''}...`;

    try {
      const response = await fetch('/api/photos/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentPhotoUrl,
          selection: Array.from(currentPhotoSelection)
        })
      });

      const data = await response.json();
      toggleSection(statusSection, false);

      if (response.ok && data.success) {
        // Trigger download
        const downloadLink = document.createElement('a');
        downloadLink.href = data.downloadUrl;
        downloadLink.download = true;
        downloadLink.click();

        // Show success message and reset
        showError('Download started! Check your downloads folder.');
        setTimeout(() => {
          resetPhotoUI();
        }, 2000);
      } else {
        showError(data.error || 'Failed to download photos.');
        toggleSection(photoResultSection, true);
      }
    } catch (err) {
      console.error('Photo download error:', err);
      showError('An error occurred while downloading photos.');
      toggleSection(statusSection, false);
      toggleSection(photoResultSection, true);
    }
  });

  btnResetPhotos.addEventListener('click', resetPhotoUI);

  function resetPhotoUI() {
    photoGrid.innerHTML = '';
    currentPhotoSelection.clear();
    currentPhotoUrl = '';
    currentPhotoData = null;
    photoSelectionText.textContent = '0 photos selected';
    tiktokUrlInput.value = '';
    toggleSection(photoResultSection, false);
    toggleSection(searchSection, true);
    hideError();
  }

  btnReset.addEventListener('click', () => {

    videoPreview.pause();
    videoPreview.removeAttribute('src');
    videoPreview.load();

    tiktokUrlInput.value = '';
    toggleSection(resultSection, false);
    toggleSection(searchSection, true);
    hideError();
  });

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
      'Validating link...',
      'Connecting to retrieval provider...',
      'Fetching media details...',
      'Processing content...',
      'Almost done, preparing download link...'
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
