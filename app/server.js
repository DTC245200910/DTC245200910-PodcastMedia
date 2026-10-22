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
    VALUES ('Trò chuyện'), ('Văn hóa'), ('Âm Nhạc'), ('Rap')
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
    ORDER BY e.created_at DESC, e.id DESC, c.name ASC
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

async function findDuplicateEpisode(title, audioUrl, excludeId) {
  const checks = ['LOWER(TRIM(title)) = LOWER(TRIM(?))'];
  const values = [title];

  if (audioUrl) {
    checks.push('audio_url = ?');
    values.push(audioUrl);
  }
  if (excludeId !== undefined) {
    values.push(excludeId);
  }

  const exclusion = excludeId === undefined ? '' : ' AND id <> ?';
  const [rows] = await db.execute(
    `SELECT id FROM episodes WHERE (${checks.join(' OR ')})${exclusion} LIMIT 1`,
    values
  );
  return rows[0] || null;
}

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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

app.put('/api/categories/:id', async (request, response) => {
  const categoryId = parsePositiveId(request.params.id);
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';

  if (!categoryId) {
    return response.status(400).json({ error: 'Invalid category id' });
  }
  if (!name || name.length > 80) {
    return response.status(400).json({ error: 'name must contain 1 to 80 characters' });
  }

  try {
    const [result] = await db.execute(
      'UPDATE categories SET name = ? WHERE id = ?',
      [name, categoryId]
    );
    if (!result.affectedRows) {
      return response.status(404).json({ error: 'Category not found' });
    }
    response.json({ id: categoryId, name });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return response.status(409).json({ error: 'Category already exists' });
    }
    console.error(error);
    response.status(500).json({ error: 'Could not update category' });
  }
});

app.delete('/api/categories/:id', async (request, response) => {
  const categoryId = parsePositiveId(request.params.id);
  if (!categoryId) {
    return response.status(400).json({ error: 'Invalid category id' });
  }

  try {
    const [result] = await db.execute(
      'DELETE FROM categories WHERE id = ?',
      [categoryId]
    );
    if (!result.affectedRows) {
      return response.status(404).json({ error: 'Category not found' });
    }
    response.status(204).end();
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Could not delete category' });
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
  const episodeId = parsePositiveId(request.params.id);
  if (!episodeId) {
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
  const title = typeof request.body.title === 'string' ? request.body.title.trim() : '';
  const description = typeof request.body.description === 'string'
    ? request.body.description.trim() || null
    : null;
  const audioUrl = typeof request.body.audio_url === 'string'
    ? request.body.audio_url.trim() || null
    : null;
  const rawCategoryId = request.body.category_id;
  const categoryId = rawCategoryId === undefined || rawCategoryId === null || rawCategoryId === ''
    ? null
    : Number(rawCategoryId);

  if (!title || title.length > 200) {
    return response.status(400).json({ error: 'title must contain 1 to 200 characters' });
  }
  if (audioUrl && audioUrl.length > 500) {
    return response.status(400).json({ error: 'audio_url cannot exceed 500 characters' });
  }
  if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) {
    return response.status(400).json({ error: 'Invalid category_id' });
  }

  try {
    if (await findDuplicateEpisode(title, audioUrl)) {
      return response.status(409).json({ error: 'Episode title or audio URL already exists' });
    }
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Could not check for duplicate episodes' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      'INSERT INTO episodes (title, description, audio_url) VALUES (?, ?, ?)',
      [title, description, audioUrl]
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
      title,
      description,
      audio_url: audioUrl,
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

app.put('/api/episodes/:id', async (request, response) => {
  const episodeId = parsePositiveId(request.params.id);
  const title = typeof request.body.title === 'string' ? request.body.title.trim() : '';
  const description = typeof request.body.description === 'string'
    ? request.body.description.trim() || null
    : null;
  const audioUrl = typeof request.body.audio_url === 'string'
    ? request.body.audio_url.trim() || null
    : null;
  const rawCategoryId = request.body.category_id;
  const categoryId = rawCategoryId === undefined || rawCategoryId === null || rawCategoryId === ''
    ? null
    : Number(rawCategoryId);

  if (!episodeId) {
    return response.status(400).json({ error: 'Invalid episode id' });
  }
  if (!title || title.length > 200) {
    return response.status(400).json({ error: 'title must contain 1 to 200 characters' });
  }
  if (audioUrl && audioUrl.length > 500) {
    return response.status(400).json({ error: 'audio_url cannot exceed 500 characters' });
  }
  if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) {
    return response.status(400).json({ error: 'Invalid category_id' });
  }

  const connection = await db.getConnection();
  try {
    const [existingRows] = await connection.execute(
      'SELECT id FROM episodes WHERE id = ?',
      [episodeId]
    );
    if (!existingRows.length) {
      return response.status(404).json({ error: 'Episode not found' });
    }

    if (await findDuplicateEpisode(title, audioUrl, episodeId)) {
      return response.status(409).json({ error: 'Episode title or audio URL already exists' });
    }

    await connection.beginTransaction();
    await connection.execute(
      'UPDATE episodes SET title = ?, description = ?, audio_url = ? WHERE id = ?',
      [title, description, audioUrl, episodeId]
    );
    await connection.execute(
      'DELETE FROM episode_categories WHERE episode_id = ?',
      [episodeId]
    );
    if (categoryId !== null) {
      await connection.execute(
        'INSERT INTO episode_categories (episode_id, category_id) VALUES (?, ?)',
        [episodeId, categoryId]
      );
    }
    await connection.commit();

    const [episode] = await getEpisodeRows(episodeId);
    response.json(episode);
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return response.status(400).json({ error: 'Category not found' });
    }
    console.error(error);
    response.status(500).json({ error: 'Could not update episode' });
  } finally {
    connection.release();
  }
});

app.delete('/api/episodes/:id', async (request, response) => {
  const episodeId = parsePositiveId(request.params.id);
  if (!episodeId) {
    return response.status(400).json({ error: 'Invalid episode id' });
  }

  try {
    const [result] = await db.execute(
      'DELETE FROM episodes WHERE id = ?',
      [episodeId]
    );
    if (!result.affectedRows) {
      return response.status(404).json({ error: 'Episode not found' });
    }
    response.status(204).end();
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Could not delete episode' });
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