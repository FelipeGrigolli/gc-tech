const express = require('express');

// Every vehicle comes back in the same shape, joined with its category.
const VEHICLE_SELECT = `
  SELECT v.plate,
         c.id         AS categoryId,
         c.section,
         c.model,
         c.label,
         c.fuel,
         c.seats,
         c.rate_cents AS rateCents,
         v.branch     AS branchCode,
         b.name       AS branchName
  FROM vehicles v
  JOIN categories c ON c.id = v.category_id
  JOIN branches   b ON b.code = v.branch
`;

function toVehicle(row) {
  const { rateCents, ...rest } = row;
  return { ...rest, dailyRate: rateCents / 100 };
}

function createApp(db) {
  const app = express();

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'gc-tech-api',
      time: new Date().toISOString(),
    });
  });

  // GET /vehicles?category=pantech&branch=PAR&section=Commercial
  // Every filter is optional; they combine with AND.
  app.get('/vehicles', (req, res) => {
    const filters = {
      category: ['c.id', req.query.category],
      branch: ['v.branch', req.query.branch],
      section: ['c.section', req.query.section],
    };

    const where = [];
    const params = [];
    for (const [column, value] of Object.values(filters)) {
      if (typeof value === 'string' && value !== '') {
        where.push(`${column} = ? COLLATE NOCASE`);
        params.push(value);
      }
    }

    const sql =
      VEHICLE_SELECT + (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY c.id, v.plate';
    const vehicles = db.prepare(sql).all(...params).map(toVehicle);
    res.json({ count: vehicles.length, vehicles });
  });

  // GET /vehicles/CZ11KS
  app.get('/vehicles/:plate', (req, res) => {
    const row = db.prepare(VEHICLE_SELECT + ' WHERE v.plate = ?').get(req.params.plate.toUpperCase());
    if (!row) {
      return res.status(404).json({ error: `Vehicle ${req.params.plate} not found` });
    }
    res.json(toVehicle(row));
  });

  // Anything that did not match a route above: JSON instead of Express's HTML page.
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  // Unexpected errors: log the detail on the server, tell the client nothing sensitive.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
