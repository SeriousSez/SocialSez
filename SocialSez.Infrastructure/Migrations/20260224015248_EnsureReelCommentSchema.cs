using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EnsureReelCommentSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            if (!ActiveProvider.Contains("MySql"))
            {
                return;
            }

            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS `ReelComments` (
                    `Id` char(36) COLLATE ascii_general_ci NOT NULL,
                    `ReelId` char(36) COLLATE ascii_general_ci NOT NULL,
                    `AuthorId` char(36) COLLATE ascii_general_ci NOT NULL,
                    `ParentCommentId` char(36) COLLATE ascii_general_ci NULL,
                    `Content` varchar(2000) CHARACTER SET utf8mb4 NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    CONSTRAINT `PK_ReelComments` PRIMARY KEY (`Id`),
                    CONSTRAINT `FK_ReelComments_Reels_ReelId` FOREIGN KEY (`ReelId`) REFERENCES `Reels` (`Id`) ON DELETE CASCADE,
                    CONSTRAINT `FK_ReelComments_UserProfiles_AuthorId` FOREIGN KEY (`AuthorId`) REFERENCES `UserProfiles` (`Id`) ON DELETE RESTRICT,
                    CONSTRAINT `FK_ReelComments_ReelComments_ParentCommentId` FOREIGN KEY (`ParentCommentId`) REFERENCES `ReelComments` (`Id`) ON DELETE RESTRICT
                ) CHARACTER SET=utf8mb4;
                """);

            migrationBuilder.Sql(
                """
                CREATE TABLE IF NOT EXISTS `ReelCommentLikes` (
                    `ReelCommentId` char(36) COLLATE ascii_general_ci NOT NULL,
                    `ProfileId` char(36) COLLATE ascii_general_ci NOT NULL,
                    `CreatedAtUtc` datetime(6) NOT NULL,
                    CONSTRAINT `PK_ReelCommentLikes` PRIMARY KEY (`ReelCommentId`, `ProfileId`),
                    CONSTRAINT `FK_ReelCommentLikes_ReelComments_ReelCommentId` FOREIGN KEY (`ReelCommentId`) REFERENCES `ReelComments` (`Id`) ON DELETE CASCADE,
                    CONSTRAINT `FK_ReelCommentLikes_UserProfiles_ProfileId` FOREIGN KEY (`ProfileId`) REFERENCES `UserProfiles` (`Id`) ON DELETE CASCADE
                ) CHARACTER SET=utf8mb4;
                """);

            migrationBuilder.Sql(
                """
                SET @has_ix_reel_comments_reel_created := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'ReelComments'
                      AND INDEX_NAME = 'IX_ReelComments_ReelId_CreatedAtUtc'
                );
                SET @sql := IF(
                    @has_ix_reel_comments_reel_created = 0,
                    'CREATE INDEX `IX_ReelComments_ReelId_CreatedAtUtc` ON `ReelComments` (`ReelId`, `CreatedAtUtc`);',
                    'SELECT 1;'
                );
                PREPARE stmt FROM @sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

            migrationBuilder.Sql(
                """
                SET @has_ix_reel_comments_author := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'ReelComments'
                      AND INDEX_NAME = 'IX_ReelComments_AuthorId'
                );
                SET @sql := IF(
                    @has_ix_reel_comments_author = 0,
                    'CREATE INDEX `IX_ReelComments_AuthorId` ON `ReelComments` (`AuthorId`);',
                    'SELECT 1;'
                );
                PREPARE stmt FROM @sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

            migrationBuilder.Sql(
                """
                SET @has_ix_reel_comments_parent := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'ReelComments'
                      AND INDEX_NAME = 'IX_ReelComments_ParentCommentId'
                );
                SET @sql := IF(
                    @has_ix_reel_comments_parent = 0,
                    'CREATE INDEX `IX_ReelComments_ParentCommentId` ON `ReelComments` (`ParentCommentId`);',
                    'SELECT 1;'
                );
                PREPARE stmt FROM @sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

            migrationBuilder.Sql(
                """
                SET @has_ix_reel_comment_likes_profile := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'ReelCommentLikes'
                      AND INDEX_NAME = 'IX_ReelCommentLikes_ProfileId'
                );
                SET @sql := IF(
                    @has_ix_reel_comment_likes_profile = 0,
                    'CREATE INDEX `IX_ReelCommentLikes_ProfileId` ON `ReelCommentLikes` (`ProfileId`);',
                    'SELECT 1;'
                );
                PREPARE stmt FROM @sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

            migrationBuilder.Sql(
                """
                SET @has_parent_comment := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'Comments'
                      AND COLUMN_NAME = 'ParentCommentId'
                );
                SET @sql := IF(
                    @has_parent_comment = 0,
                    'ALTER TABLE `Comments` ADD COLUMN `ParentCommentId` char(36) COLLATE ascii_general_ci NULL;',
                    'SELECT 1;'
                );
                PREPARE stmt FROM @sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

            migrationBuilder.Sql(
                """
                SET @has_ix_comments_parent := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'Comments'
                      AND INDEX_NAME = 'IX_Comments_ParentCommentId'
                );
                SET @sql := IF(
                    @has_ix_comments_parent = 0,
                    'CREATE INDEX `IX_Comments_ParentCommentId` ON `Comments` (`ParentCommentId`);',
                    'SELECT 1;'
                );
                PREPARE stmt FROM @sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            if (!ActiveProvider.Contains("MySql"))
            {
                return;
            }

            migrationBuilder.Sql("DROP TABLE IF EXISTS `ReelCommentLikes`;");
            migrationBuilder.Sql("DROP TABLE IF EXISTS `ReelComments`;");
        }
    }
}
