SET NAMES utf8mb4;

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
VALUES ('Trò chuyện'), ('Văn hóa'), ('Âm Nhạc'), ('Rap');

INSERT INTO episodes (title, description, audio_url, created_at)
SELECT seed.title, seed.description, seed.audio_url,
  DATE_SUB(CURRENT_TIMESTAMP, INTERVAL (11 - seed.display_order) SECOND)
FROM (
  SELECT 1 AS display_order, 'KHÔNG MÔN ĐĂNG HỘ ĐỐI - NGUYỄN VĨ | OFFICIAL MUSIC VIDEO' AS title,
         'hay' AS description, 'https://www.youtube.com/watch?v=KNnSoRrDb5g' AS audio_url
  UNION ALL SELECT 2, 'LVBEL C5, AKDO - COOOK PARDON', 'nice', 'https://www.youtube.com/watch?v=wGAH8PSk-rg'
  UNION ALL SELECT 3, 'Powfu - death bed (coffee for your head) (Official Video) ft. beabadoobee', 'chill', 'https://www.youtube.com/watch?v=jJPMnTXl63E'
  UNION ALL SELECT 4, 'Thương Nhau Đến Thế (Jerk Drill Mix) - Gia Huy | Audio Drill Lyrics', 'hay', 'https://www.youtube.com/watch?v=4TxzeEZ3Qqc'
  UNION ALL SELECT 5, 'NƠI NÀY CÓ ANH | OFFICIAL MUSIC VIDEO | SƠN TÙNG M-TP', 'hayy', 'https://www.youtube.com/watch?v=FN7ALfpGxiI'
  UNION ALL SELECT 6, 'Hngle - Tìm em ft. Bảo Anh', 'hay', 'https://www.youtube.com/watch?v=gJAbDSse5WM'
  UNION ALL SELECT 7, 'GREY D - dự báo thời tiết hôm nay mưa', 'hayy', 'https://www.youtube.com/watch?v=heMYSOZoT3c'
  UNION ALL SELECT 8, 'Dangrangto - ''xương rồng (intro)'' (Prod. DONAL)', 'hayy', 'https://www.youtube.com/watch?v=4jjOH2FR6-E'
  UNION ALL SELECT 9, '[PODCAST] Sự Trở Lại Của Nguyễn Tấn Dũng Tái Xuất Chính Trường Việt Nam', 'chia sẻ những cuộc trò chuyện sâu sắc, cập nhật và đa góc nhìn xoay quanh các chủ đề thời sự, công nghệ, đời sống và xu hướng mới.', 'https://www.youtube.com/watch?v=evv567czN0w&t=45s'
  UNION ALL SELECT 10, 'TRÒ CHUYỆN CÙNG CARL JUNG 1957: Học Trực Tiếp Cùng Bậc Thầy', 'là thước phim ghi lại các cuộc phỏng vấn lịch sử vào năm 1957 giữa Tiến sĩ Carl Gustav Jung và Giáo sư Tâm lý học Richard I. Evans thuộc Đại học Houston.', 'https://www.youtube.com/watch?v=EydOI1F44_o'
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM episodes existing
  WHERE existing.title = seed.title OR existing.audio_url = seed.audio_url
)
ORDER BY seed.display_order;

INSERT IGNORE INTO episode_categories (episode_id, category_id)
SELECT episode.id, category.id
FROM (
  SELECT 'https://www.youtube.com/watch?v=KNnSoRrDb5g' AS audio_url, 'Âm Nhạc' AS category_name
  UNION ALL SELECT 'https://www.youtube.com/watch?v=wGAH8PSk-rg', 'Rap'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=jJPMnTXl63E', 'Âm Nhạc'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=4TxzeEZ3Qqc', 'Âm Nhạc'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=FN7ALfpGxiI', 'Âm Nhạc'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=gJAbDSse5WM', 'Âm Nhạc'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=heMYSOZoT3c', 'Âm Nhạc'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=4jjOH2FR6-E', 'Âm Nhạc'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=evv567czN0w&t=45s', 'Văn hóa'
  UNION ALL SELECT 'https://www.youtube.com/watch?v=EydOI1F44_o', 'Trò chuyện'
) AS seed
JOIN episodes episode ON episode.audio_url = seed.audio_url
JOIN categories category ON category.name = seed.category_name;