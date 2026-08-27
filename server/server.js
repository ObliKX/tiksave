require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const downloadRoutes = require('./routes/download');
const shortcutRoutes = require('./routes/shortcut');
const { startCleanupScheduler } = require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Basic Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, 
  legacyHeaders: false, 
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});

// Apply rate limiter to API routes
app.use('/api/', apiLimiter);

// 2. Middlewares
app.use(cors());
app.use(express.json({ limit: '10kb' })); // Restrict request payload size to prevent DDoS
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 3. Static Files
app.use(express.static(path.join(__dirname, '..', 'public')));

// 4. API Routes
app.use('/api', downloadRoutes);
app.use('/api/shortcut', shortcutRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Fallback for single page app routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 5. Start Temporary Files Cleanup Scheduler
// Scan every 5 minutes and delete files older than 15 minutes (Only on standalone servers)
if (!process.env.NETLIFY) {
  startCleanupScheduler(5 * 60 * 1000);
}

// 6. Start server (Only on standalone servers)
if (!process.env.NETLIFY) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` TikSave Server running in ${process.env.NODE_ENV || 'production'} mode`);
    console.log(` Local URL: http://localhost:${PORT}`);
    console.log(` Active Provider: ${process.env.TIKTOK_PROVIDER || 'not set'}`);
    console.log(`==================================================`);
  });
}

module.exports = app;
