const express = require('express');

function createApp() {
  const app = express();

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'gc-tech-api',
      time: new Date().toISOString(),
    });
  });

  return app;
}

module.exports = { createApp };
