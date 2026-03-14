using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddContentDraftScheduling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsDraft",
                table: "Stories",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "PublishedAtUtc",
                table: "Stories",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ScheduledPublishAtUtc",
                table: "Stories",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDraft",
                table: "Reels",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "PublishedAtUtc",
                table: "Reels",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ScheduledPublishAtUtc",
                table: "Reels",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDraft",
                table: "Posts",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "PublishedAtUtc",
                table: "Posts",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ScheduledPublishAtUtc",
                table: "Posts",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ReelAbTests",
                columns: table => new
                {
                    ReelId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    OwnerId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    VariantATitle = table.Column<string>(type: "varchar(220)", maxLength: 220, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    VariantAThumbnailUrl = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    VariantBTitle = table.Column<string>(type: "varchar(220)", maxLength: 220, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    VariantBThumbnailUrl = table.Column<string>(type: "varchar(1024)", maxLength: 1024, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    IsActive = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    WinningVariantKey = table.Column<string>(type: "varchar(1)", maxLength: 1, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VariantAImpressions = table.Column<int>(type: "int", nullable: false),
                    VariantBImpressions = table.Column<int>(type: "int", nullable: false),
                    VariantAViews = table.Column<int>(type: "int", nullable: false),
                    VariantBViews = table.Column<int>(type: "int", nullable: false),
                    VariantAWatchSeconds = table.Column<double>(type: "double", nullable: false),
                    VariantBWatchSeconds = table.Column<double>(type: "double", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReelAbTests", x => x.ReelId);
                    table.ForeignKey(
                        name: "FK_ReelAbTests_Reels_ReelId",
                        column: x => x.ReelId,
                        principalTable: "Reels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ReelAbTests_UserProfiles_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "ReelPlaybacks",
                columns: table => new
                {
                    ReelId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ViewerId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    LastPositionSeconds = table.Column<double>(type: "double", nullable: false),
                    TotalWatchedSeconds = table.Column<double>(type: "double", nullable: false),
                    IsCompleted = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    FirstViewedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    LastViewedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    VariantKey = table.Column<string>(type: "varchar(1)", maxLength: 1, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReelPlaybacks", x => new { x.ReelId, x.ViewerId });
                    table.ForeignKey(
                        name: "FK_ReelPlaybacks_Reels_ReelId",
                        column: x => x.ReelId,
                        principalTable: "Reels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ReelPlaybacks_UserProfiles_ViewerId",
                        column: x => x.ViewerId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "StoryPlaybackProgresses",
                columns: table => new
                {
                    ViewerId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    AuthorId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    StoryId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    LastPositionSeconds = table.Column<double>(type: "double", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoryPlaybackProgresses", x => new { x.ViewerId, x.AuthorId });
                    table.ForeignKey(
                        name: "FK_StoryPlaybackProgresses_Stories_StoryId",
                        column: x => x.StoryId,
                        principalTable: "Stories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoryPlaybackProgresses_UserProfiles_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoryPlaybackProgresses_UserProfiles_ViewerId",
                        column: x => x.ViewerId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_Stories_AuthorId_IsDraft_ScheduledPublishAtUtc",
                table: "Stories",
                columns: new[] { "AuthorId", "IsDraft", "ScheduledPublishAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Stories_IsDraft_ScheduledPublishAtUtc",
                table: "Stories",
                columns: new[] { "IsDraft", "ScheduledPublishAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Reels_AuthorId_IsDraft_ScheduledPublishAtUtc",
                table: "Reels",
                columns: new[] { "AuthorId", "IsDraft", "ScheduledPublishAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Reels_IsDraft_ScheduledPublishAtUtc",
                table: "Reels",
                columns: new[] { "IsDraft", "ScheduledPublishAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_AuthorId_IsDraft_ScheduledPublishAtUtc",
                table: "Posts",
                columns: new[] { "AuthorId", "IsDraft", "ScheduledPublishAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Posts_IsDraft_ScheduledPublishAtUtc",
                table: "Posts",
                columns: new[] { "IsDraft", "ScheduledPublishAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ReelAbTests_OwnerId_IsActive_UpdatedAtUtc",
                table: "ReelAbTests",
                columns: new[] { "OwnerId", "IsActive", "UpdatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ReelPlaybacks_LastViewedAtUtc",
                table: "ReelPlaybacks",
                column: "LastViewedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_ReelPlaybacks_ViewerId",
                table: "ReelPlaybacks",
                column: "ViewerId");

            migrationBuilder.CreateIndex(
                name: "IX_StoryPlaybackProgresses_AuthorId",
                table: "StoryPlaybackProgresses",
                column: "AuthorId");

            migrationBuilder.CreateIndex(
                name: "IX_StoryPlaybackProgresses_StoryId",
                table: "StoryPlaybackProgresses",
                column: "StoryId");

            migrationBuilder.CreateIndex(
                name: "IX_StoryPlaybackProgresses_UpdatedAtUtc",
                table: "StoryPlaybackProgresses",
                column: "UpdatedAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReelAbTests");

            migrationBuilder.DropTable(
                name: "ReelPlaybacks");

            migrationBuilder.DropTable(
                name: "StoryPlaybackProgresses");

            migrationBuilder.DropIndex(
                name: "IX_Stories_AuthorId_IsDraft_ScheduledPublishAtUtc",
                table: "Stories");

            migrationBuilder.DropIndex(
                name: "IX_Stories_IsDraft_ScheduledPublishAtUtc",
                table: "Stories");

            migrationBuilder.DropIndex(
                name: "IX_Reels_AuthorId_IsDraft_ScheduledPublishAtUtc",
                table: "Reels");

            migrationBuilder.DropIndex(
                name: "IX_Reels_IsDraft_ScheduledPublishAtUtc",
                table: "Reels");

            migrationBuilder.DropIndex(
                name: "IX_Posts_AuthorId_IsDraft_ScheduledPublishAtUtc",
                table: "Posts");

            migrationBuilder.DropIndex(
                name: "IX_Posts_IsDraft_ScheduledPublishAtUtc",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "IsDraft",
                table: "Stories");

            migrationBuilder.DropColumn(
                name: "PublishedAtUtc",
                table: "Stories");

            migrationBuilder.DropColumn(
                name: "ScheduledPublishAtUtc",
                table: "Stories");

            migrationBuilder.DropColumn(
                name: "IsDraft",
                table: "Reels");

            migrationBuilder.DropColumn(
                name: "PublishedAtUtc",
                table: "Reels");

            migrationBuilder.DropColumn(
                name: "ScheduledPublishAtUtc",
                table: "Reels");

            migrationBuilder.DropColumn(
                name: "IsDraft",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "PublishedAtUtc",
                table: "Posts");

            migrationBuilder.DropColumn(
                name: "ScheduledPublishAtUtc",
                table: "Posts");
        }
    }
}
