using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCommunityPostLinksAndImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            if (ActiveProvider.Contains("MySql", StringComparison.OrdinalIgnoreCase))
            {
                migrationBuilder.Sql("""
                SET @has_link_url := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'CommunityPosts'
                      AND COLUMN_NAME = 'LinkUrl'
                );
                SET @sql_link_url := IF(@has_link_url = 0,
                    'ALTER TABLE `CommunityPosts` ADD COLUMN `LinkUrl` varchar(2048) NULL;',
                    'SELECT 1');
                PREPARE stmt_link_url FROM @sql_link_url;
                EXECUTE stmt_link_url;
                DEALLOCATE PREPARE stmt_link_url;
                """);

                migrationBuilder.Sql("""
                CREATE TABLE IF NOT EXISTS `CommunityPostImages` (
                    `Id` char(36) COLLATE ascii_general_ci NOT NULL,
                    `PostId` char(36) COLLATE ascii_general_ci NOT NULL,
                    `Url` varchar(1024) CHARACTER SET utf8mb4 NOT NULL,
                    `SortOrder` int NOT NULL DEFAULT 0,
                    CONSTRAINT `PK_CommunityPostImages` PRIMARY KEY (`Id`),
                    CONSTRAINT `FK_CommunityPostImages_CommunityPosts_PostId` FOREIGN KEY (`PostId`) REFERENCES `CommunityPosts` (`Id`) ON DELETE CASCADE
                ) CHARACTER SET=utf8mb4;
                """);

                migrationBuilder.Sql("""
                SET @has_images_index := (
                    SELECT COUNT(*)
                    FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'CommunityPostImages'
                      AND INDEX_NAME = 'IX_CommunityPostImages_PostId_SortOrder'
                );
                SET @sql_images_index := IF(@has_images_index = 0,
                    'CREATE INDEX `IX_CommunityPostImages_PostId_SortOrder` ON `CommunityPostImages` (`PostId`, `SortOrder`);',
                    'SELECT 1');
                PREPARE stmt_images_index FROM @sql_images_index;
                EXECUTE stmt_images_index;
                DEALLOCATE PREPARE stmt_images_index;
                """);
            }
            else
            {
                migrationBuilder.AddColumn<string>(
                    name: "LinkUrl",
                    table: "CommunityPosts",
                    type: "TEXT",
                    maxLength: 2048,
                    nullable: true);

                migrationBuilder.CreateTable(
                    name: "CommunityPostImages",
                    columns: table => new
                    {
                        Id = table.Column<Guid>(type: "TEXT", nullable: false),
                        PostId = table.Column<Guid>(type: "TEXT", nullable: false),
                        Url = table.Column<string>(type: "TEXT", maxLength: 1024, nullable: false),
                        SortOrder = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0)
                    },
                    constraints: table =>
                    {
                        table.PrimaryKey("PK_CommunityPostImages", x => x.Id);
                        table.ForeignKey(
                            name: "FK_CommunityPostImages_CommunityPosts_PostId",
                            column: x => x.PostId,
                            principalTable: "CommunityPosts",
                            principalColumn: "Id",
                            onDelete: ReferentialAction.Cascade);
                    });

                migrationBuilder.CreateIndex(
                    name: "IX_CommunityPostImages_PostId_SortOrder",
                    table: "CommunityPostImages",
                    columns: new[] { "PostId", "SortOrder" });
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CommunityPostImages");

            migrationBuilder.DropColumn(
                name: "LinkUrl",
                table: "CommunityPosts");
        }
    }
}
