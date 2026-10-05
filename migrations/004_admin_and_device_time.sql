ALTER TABLE `devices` ADD COLUMN `registered_at` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `registration_control` (
    `id` INTEGER PRIMARY KEY CHECK (`id` = 1),
    `open_until` INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO `registration_control` (`id`, `open_until`) VALUES (1, 0);
