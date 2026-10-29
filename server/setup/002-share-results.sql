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
