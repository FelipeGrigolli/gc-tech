const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { categories, branches, buildVehicles } = require('./fleet-seed');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'gc-tech.db');

// Opens the database (a file, or ':memory:' for tests), creates the tables
// if they do not exist yet and fills them on the very first run.
function openDb(file = DEFAULT_FILE) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('foreign_keys = ON');

  // Money is stored in cents (integer): 59.00 AUD -> 5900. Decimals (0.1 + 0.2)
  // cannot represent every amount exactly, integers can.
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT PRIMARY KEY,
      section    TEXT NOT NULL CHECK (section IN ('Passenger', 'Commercial')),
      name       TEXT NOT NULL,
      model      TEXT NOT NULL,
      label      TEXT NOT NULL,
      rate_cents INTEGER NOT NULL,
      fuel       TEXT NOT NULL,
      seats      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS branches (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      plate       TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id),
      branch      TEXT NOT NULL REFERENCES branches(code)
    );
  `);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM vehicles').get();
  if (n > 0) return;

  const insertCategory = db.prepare(
    `INSERT INTO categories (id, section, name, model, label, rate_cents, fuel, seats)
     VALUES (@id, @section, @name, @model, @label, @rate_cents, @fuel, @seats)`
  );
  const insertBranch = db.prepare('INSERT INTO branches (code, name) VALUES (@code, @name)');
  const insertVehicle = db.prepare(
    'INSERT INTO vehicles (plate, category_id, branch) VALUES (@plate, @categoryId, @branch)'
  );

  // One transaction: either everything is inserted or nothing is.
  db.transaction(() => {
    categories.forEach((c) => insertCategory.run({ ...c, rate_cents: Math.round(c.rate * 100) }));
    branches.forEach((b) => insertBranch.run(b));
    buildVehicles().forEach((v) => insertVehicle.run(v));
  })();
}

module.exports = { openDb };
