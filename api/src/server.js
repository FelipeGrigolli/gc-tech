const { createApp } = require('./app');
const { openDb } = require('./db');

const port = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_FILE);

createApp(db).listen(port, () => {
  console.log(`GC Tech API listening on http://localhost:${port}`);
});
