using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSavedItemCommunityAndBlogTargets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            if (ActiveProvider.Contains("MySql", StringComparison.OrdinalIgnoreCase))
            {
                migrationBuilder.Sql("ALTER TABLE `SavedItems` MODIFY COLUMN `ItemType` varchar(32) CHARACTER SET utf8mb4 NOT NULL;");
                migrationBuilder.Sql("""
                SET @has_blog_col := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND COLUMN_NAME = 'BlogPostId'
                );
                SET @blog_col_sql := IF(
                    @has_blog_col = 0,
                    'ALTER TABLE `SavedItems` ADD COLUMN `BlogPostId` char(36) COLLATE ascii_general_ci NULL',
                    'SELECT 1'
                );
                PREPARE stmt FROM @blog_col_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @has_community_col := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND COLUMN_NAME = 'CommunityPostId'
                );
                SET @community_col_sql := IF(
                    @has_community_col = 0,
                    'ALTER TABLE `SavedItems` ADD COLUMN `CommunityPostId` char(36) COLLATE ascii_general_ci NULL',
                    'SELECT 1'
                );
                PREPARE stmt FROM @community_col_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @has_blog_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_BlogPostId'
                );
                SET @blog_idx_sql := IF(
                    @has_blog_idx = 0,
                    'CREATE INDEX `IX_SavedItems_BlogPostId` ON `SavedItems` (`BlogPostId`)',
                    'SELECT 1'
                );
                PREPARE stmt FROM @blog_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @has_community_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_CommunityPostId'
                );
                SET @community_idx_sql := IF(
                    @has_community_idx = 0,
                    'CREATE INDEX `IX_SavedItems_CommunityPostId` ON `SavedItems` (`CommunityPostId`)',
                    'SELECT 1'
                );
                PREPARE stmt FROM @community_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @has_profile_blog_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_ProfileId_BlogPostId'
                );
                SET @profile_blog_idx_sql := IF(
                    @has_profile_blog_idx = 0,
                    'CREATE UNIQUE INDEX `IX_SavedItems_ProfileId_BlogPostId` ON `SavedItems` (`ProfileId`, `BlogPostId`)',
                    'SELECT 1'
                );
                PREPARE stmt FROM @profile_blog_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @has_profile_community_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_ProfileId_CommunityPostId'
                );
                SET @profile_community_idx_sql := IF(
                    @has_profile_community_idx = 0,
                    'CREATE UNIQUE INDEX `IX_SavedItems_ProfileId_CommunityPostId` ON `SavedItems` (`ProfileId`, `CommunityPostId`)',
                    'SELECT 1'
                );
                PREPARE stmt FROM @profile_community_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            if (ActiveProvider.Contains("MySql", StringComparison.OrdinalIgnoreCase))
            {
                migrationBuilder.Sql("""
                SET @drop_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_ProfileId_CommunityPostId'
                );
                SET @drop_idx_sql := IF(
                    @drop_idx > 0,
                    'DROP INDEX `IX_SavedItems_ProfileId_CommunityPostId` ON `SavedItems`',
                    'SELECT 1'
                );
                PREPARE stmt FROM @drop_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @drop_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_ProfileId_BlogPostId'
                );
                SET @drop_idx_sql := IF(
                    @drop_idx > 0,
                    'DROP INDEX `IX_SavedItems_ProfileId_BlogPostId` ON `SavedItems`',
                    'SELECT 1'
                );
                PREPARE stmt FROM @drop_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @drop_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_CommunityPostId'
                );
                SET @drop_idx_sql := IF(
                    @drop_idx > 0,
                    'DROP INDEX `IX_SavedItems_CommunityPostId` ON `SavedItems`',
                    'SELECT 1'
                );
                PREPARE stmt FROM @drop_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);

                migrationBuilder.Sql("""
                SET @drop_idx := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'SavedItems'
                      AND INDEX_NAME = 'IX_SavedItems_BlogPostId'
                );
                SET @drop_idx_sql := IF(
                    @drop_idx > 0,
                    'DROP INDEX `IX_SavedItems_BlogPostId` ON `SavedItems`',
                    'SELECT 1'
                );
                PREPARE stmt FROM @drop_idx_sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);
            }
        }
    }
}
