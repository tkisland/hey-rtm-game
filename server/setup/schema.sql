CREATE TABLE IF NOT EXISTS rhythm_schema (
  id TINYINT UNSIGNED PRIMARY KEY,
  version INT UNSIGNED NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO rhythm_schema (id,version) VALUES (1,1);

CREATE TABLE IF NOT EXISTS rhythm_boards (
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  song_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  difficulty VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  chart_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rules_version INT UNSIGNED NOT NULL,
  chart_json MEDIUMTEXT NOT NULL,
  minimum_seconds INT UNSIGNED NOT NULL,
  UNIQUE KEY chart_version (song_id,difficulty,chart_hash,rules_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rhythm_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  board_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at BIGINT UNSIGNED NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  KEY expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rhythm_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  board_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  submission_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  score INT UNSIGNED NOT NULL,
  max_combo SMALLINT UNSIGNED NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY one_entry_per_play (token_hash),
  KEY ranking_order (board_id,score,max_combo,id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rhythm_rate_limits (
  ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bucket BIGINT UNSIGNED NOT NULL,
  hits INT UNSIGNED NOT NULL,
  PRIMARY KEY (ip_hash,bucket)
) ENGINE=InnoDB;
-- Additive migration. Run once before uploading the new site; safe to rerun.
-- Existing ranking tables and schema version 1 are preserved.
CREATE TABLE IF NOT EXISTS rhythm_shared_results (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  board_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  song_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  difficulty VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(255) NOT NULL,
  rules_version INT UNSIGNED NOT NULL,
  score INT UNSIGNED NOT NULL,
  base_score INT UNSIGNED NOT NULL,
  max_combo SMALLINT UNSIGNED NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY one_share_per_play (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
