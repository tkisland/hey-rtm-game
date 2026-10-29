-- Additive; existing rankings, share IDs and schema version 1 are preserved.
CREATE TABLE IF NOT EXISTS rhythm_entry_visibility (
  entry_id BIGINT UNSIGNED PRIMARY KEY,
  hidden TINYINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  reason VARCHAR(200) NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS rhythm_moderation_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entry_id BIGINT UNSIGNED NOT NULL,
  hidden TINYINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  reason VARCHAR(200) NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  KEY entry_history (entry_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
