require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const downloadRoutes = require('./routes/download');
const shortcutRoutes = require('./routes/shortcut');
const photoRoutes = require('./routes/photos');
const { startCleanupScheduler } = require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  standardHeaders: true, 
  legacyHeaders: false, 
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});

app.use('/api/', apiLimiter);

app.use(cors());
app.use(express.json({ limit: '10kb' })); 
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', downloadRoutes);
app.use('/api/shortcut', shortcutRoutes);
app.use('/api/photos', photoRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

if (!process.env.NETLIFY) {
  startCleanupScheduler(5 * 60 * 1000);
}

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
