CREATE TABLE IF NOT EXISTS episodes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  audio_url VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_category_name (name)
);

CREATE TABLE IF NOT EXISTS episode_categories (
  episode_id BIGINT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (episode_id, category_id),
  CONSTRAINT fk_episode_categories_episode
    FOREIGN KEY (episode_id) REFERENCES episodes (id) ON DELETE CASCADE,
  CONSTRAINT fk_episode_categories_category
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
);

INSERT IGNORE INTO categories (name)
VALUES ('Trò chuyện'), ('Công nghệ'), ('Văn hóa');