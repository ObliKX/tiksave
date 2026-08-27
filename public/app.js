document.addEventListener('DOMContentLoaded', () => {
  // UI Sections
  const searchSection = document.getElementById('search-section');
  const statusSection = document.getElementById('status-section');
  const errorSection = document.getElementById('error-section');
  const resultSection = document.getElementById('result-section');

  // Interactive buttons and inputs
  const form = document.getElementById('downloader-form');
  const tiktokUrlInput = document.getElementById('tiktok-url');
  const btnPaste = document.getElementById('btn-paste');
  const btnDownload = document.getElementById('btn-download');
  const btnCloseError = document.getElementById('btn-close-error');
  
  // Dynamic messages
  const statusMessage = document.getElementById('status-message');
  const errorMessage = document.getElementById('error-message');
  
  // Results details
  const resultTitle = document.getElementById('result-title');
  const resultQuality = document.getElementById('result-quality');
  const videoPreview = document.getElementById('video-preview');
  const btnFileDownload = document.getElementById('btn-file-download');
  const btnReset = document.getElementById('btn-reset');

  let statusInterval = null;

  // Paste from clipboard handler
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

  // Close Error Banner
  btnCloseError.addEventListener('click', hideError);

  // Form Submit Handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = tiktokUrlInput.value.trim();

    if (!url) {
      showError('Please paste a TikTok video URL first.');
      return;
    }

    // URL scheme check
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      showError('Invalid link. TikTok links must start with http:// or https://');
      return;
    }

    // Basic domain check
    if (!url.includes('tiktok.com')) {
      showError('Please enter a valid TikTok URL (e.g. vm.tiktok.com/... or tiktok.com/@username/video/...)');
      return;
    }

    // Show Loading panel
    hideError();
    toggleSection(searchSection, false);
    toggleSection(statusSection, true);
    
    // Rotate processing messages for a premium feel
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

      if (response.ok && data.success) {
        // Load video information
        resultTitle.textContent = data.title || 'TikTok Video';
        resultQuality.textContent = data.quality || 'HD';
        
        // Load author info
        if (data.author) {
          document.getElementById('author-avatar').src = data.author.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.author.nickname || 'User') + '&background=000&color=fff';
          document.getElementById('author-nickname').textContent = data.author.nickname || 'Unknown User';
          document.getElementById('author-username').textContent = '@' + (data.author.unique_id || 'user');
        }
        
        // Load stats with a formatter
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
        
        // Point preview and download button to the server file link
        videoPreview.src = data.downloadUrl;
        btnFileDownload.href = data.downloadUrl;

        toggleSection(statusSection, false);
        toggleSection(resultSection, true);
        videoPreview.load(); // Load video buffer
      } else {
        // Display server-returned error
        showError(data.error || 'Unable to process this video.');
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

  // Reset Handler to process another video
  btnReset.addEventListener('click', () => {
    // Pause video playback and empty source
    videoPreview.pause();
    videoPreview.removeAttribute('src');
    videoPreview.load();
    
    // Toggle screens back to main search
    tiktokUrlInput.value = '';
    toggleSection(resultSection, false);
    toggleSection(searchSection, true);
    hideError();
  });

  // View state helpers
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
      'Validating video link...',
      'Connecting to retrieval provider...',
      'Fetching video details...',
      'Downloading stream to temporary cache...',
      'Processing high-definition video...',
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
