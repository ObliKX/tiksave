process.env.NETLIFY = 'true';
const serverless = require('serverless-http');
const app = require('../../server/server');

module.exports.handler = serverless(app);
