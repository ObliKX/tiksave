const fs = require('fs');
const path = require('path');

const CLEANUP_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'downloads');

/**
 * Periodically cleans up files in the downloads directory that are older than the threshold.
 */
function cleanupTempFiles() {
  console.log(`[Cleanup] Scanning directory: ${DOWNLOADS_DIR}`);
  
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    console.log('[Cleanup] Downloads directory does not exist. Skipping.');
    return;
  }

  fs.readdir(DOWNLOADS_DIR, (err, files) => {
    if (err) {
      console.error('[Cleanup] Error reading downloads directory:', err);
      return;
    }

    const now = Date.now();

    files.forEach((file) => {
      if (file === '.gitkeep') return;

      const filePath = path.join(DOWNLOADS_DIR, file);

      fs.stat(filePath, (statErr, stats) => {
        if (statErr) {
          console.error(`[Cleanup] Error stating file ${file}:`, statErr);
          return;
        }

        const ageMs = now - stats.mtimeMs;

        if (ageMs > CLEANUP_THRESHOLD_MS) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`[Cleanup] Error deleting file ${file}:`, unlinkErr);
            } else {
              console.log(`[Cleanup] Deleted expired file: ${file} (age: ${Math.round(ageMs / 1000 / 60)} mins)`);
            }
          });
        }
      });
    });
  });
}

/**
 * Starts a background interval to clean up files.
 * @param {number} intervalMs The frequency of scan checks (defaults to 5 minutes)
 * @returns {NodeJS.Timeout} The interval object
 */
function startCleanupScheduler(intervalMs = 5 * 60 * 1000) {
  console.log(`[Cleanup] Scheduler started. Checks run every ${intervalMs / 1000 / 60} minutes.`);
  cleanupTempFiles();
  return setInterval(cleanupTempFiles, intervalMs);
}

module.exports = {
  cleanupTempFiles,
  startCleanupScheduler
};
