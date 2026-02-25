using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddLastHandleChangeAtUtc : Migration
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
                SET @has_col := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'UserProfiles'
                      AND COLUMN_NAME = 'LastHandleChangeAtUtc'
                );
                SET @sql := IF(
                    @has_col = 0,
                    'ALTER TABLE `UserProfiles` ADD COLUMN `LastHandleChangeAtUtc` datetime(6) NULL;',
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

            migrationBuilder.Sql(
                """
                SET @has_col := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'UserProfiles'
                      AND COLUMN_NAME = 'LastHandleChangeAtUtc'
                );
                SET @sql := IF(
                    @has_col > 0,
                    'ALTER TABLE `UserProfiles` DROP COLUMN `LastHandleChangeAtUtc`;',
                    'SELECT 1;'
                );
                PREPARE stmt FROM @sql;
                EXECUTE stmt;
                DEALLOCATE PREPARE stmt;
                """);
        }
    }
}
