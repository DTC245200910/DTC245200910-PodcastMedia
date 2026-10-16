require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env'),
});

const express = require('express');
const client = require('prom-client');
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT) || 3000;

const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

async function initializeDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(80) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_category_name (name)
    ) ENGINE=InnoDB
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS episode_categories (
      episode_id BIGINT UNSIGNED NOT NULL,
      category_id INT UNSIGNED NOT NULL,
      PRIMARY KEY (episode_id, category_id),
      CONSTRAINT fk_episode_categories_episode
        FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE,
      CONSTRAINT fk_episode_categories_category
        FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await db.query(`
    INSERT IGNORE INTO categories (name)
    VALUES ('Trò chuyện'), ('Công nghệ'), ('Văn hóa')
  `);
}

async function getEpisodeRows(episodeId) {
  const sql = `
    SELECT
      e.id,
      e.title,
      e.description,
      e.audio_url,
      e.created_at,
      c.id AS category_id,
      c.name AS category_name
    FROM episodes e
    LEFT JOIN episode_categories ec ON ec.episode_id = e.id
    LEFT JOIN categories c ON c.id = ec.category_id
    ${episodeId === undefined ? '' : 'WHERE e.id = ?'}
    ORDER BY e.created_at DESC, c.name ASC
  `;

  const [rows] = episodeId === undefined
    ? await db.query(sql)
    : await db.execute(sql, [episodeId]);
  const episodes = new Map();

  for (const row of rows) {
    if (!episodes.has(row.id)) {
      episodes.set(row.id, {
        id: row.id,
        title: row.title,
        description: row.description,
        audio_url: row.audio_url,
        created_at: row.created_at,
        categories: [],
      });
    }

    if (row.category_id !== null) {
      episodes.get(row.id).categories.push({
        id: row.category_id,
        name: row.category_name,
      });
    }
  }

  return [...episodes.values()];
}

app.use(express.json());

app.use((request, response, next) => {
  const startedAt = Date.now();

  response.on('finish', () => {
    const route = request.route
        ? `${request.baseUrl}${request.route.path}`
        : 'unmatched';

    const labels = {
        method: request.method,
        route,
        status_code: String(response.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(
        labels,
        (Date.now() - startedAt) / 1000
    );

    console.log(
      `${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms`
    );
  });

  next();
});

app.use(express.static(require('path').join(__dirname, 'public')));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'podcast-api' });
});

app.get('/health/db', async (_request, response) => {
  try {
    await db.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error(error);
    response.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

app.get('/api/categories', async (_request, response) => {
  try {
    const [categories] = await db.query(
      'SELECT id, name FROM categories ORDER BY name ASC'
    );
    response.json(categories);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Could not load categories' });
  }
});

app.post('/api/categories', async (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';

  if (!name || name.length > 80) {
    return response.status(400).json({ error: 'name must contain 1 to 80 characters' });
  }

  try {
    const [result] = await db.execute(
      'INSERT INTO categories (name) VALUES (?)',
      [name]
    );
    response.status(201).json({ id: result.insertId, name });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return response.status(409).json({ error: 'Category already exists' });
    }
    console.error(error);
    response.status(500).json({ error: 'Could not create category' });
  }
});

app.get('/api/episodes', async (_request, response) => {
  try {
    const episodes = await getEpisodeRows();
    response.json(episodes);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Could not load episodes' });
  }
});

app.get('/api/episodes/:id', async (request, response) => {
  const episodeId = Number(request.params.id);
  if (!Number.isSafeInteger(episodeId) || episodeId < 1) {
    return response.status(400).json({ error: 'Invalid episode id' });
  }

  try {
    const [episode] = await getEpisodeRows(episodeId);
    if (!episode) {
      return response.status(404).json({ error: 'Episode not found' });
    }
    response.json(episode);
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Could not load episode' });
  }
});

app.post('/api/episodes', async (request, response) => {
  const { title, description = null, audio_url = null } = request.body;
  const rawCategoryId = request.body.category_id;
  const categoryId = rawCategoryId === undefined || rawCategoryId === null || rawCategoryId === ''
    ? null
    : Number(rawCategoryId);

  if (typeof title !== 'string' || !title.trim()) {
    return response.status(400).json({ error: 'title is required' });
  }
  if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) {
    return response.status(400).json({ error: 'Invalid category_id' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      'INSERT INTO episodes (title, description, audio_url) VALUES (?, ?, ?)',
      [title.trim(), description, audio_url]
    );

    if (categoryId !== null) {
      await connection.execute(
        'INSERT INTO episode_categories (episode_id, category_id) VALUES (?, ?)',
        [result.insertId, categoryId]
      );
    }
    await connection.commit();

    response.status(201).json({
      id: result.insertId,
      title: title.trim(),
      description,
      audio_url,
      category_id: categoryId,
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return response.status(400).json({ error: 'Category not found' });
    }
    console.error(error);
    response.status(500).json({ error: 'Could not create episode' });
  } finally {
    connection.release();
  }
});

app.get('/metrics', async (_request, response) => {
  response.set('Content-Type', register.contentType);
  response.end(await register.metrics());
});

initializeDatabase()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Podcast API listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed', error);
    process.exit(1);
  });