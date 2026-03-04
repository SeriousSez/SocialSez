using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCommunitySavedPosts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CommunitySavedPosts",
                columns: table => new
                {
                    PostId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ProfileId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    SavedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommunitySavedPosts", x => new { x.PostId, x.ProfileId });
                    table.ForeignKey(
                        name: "FK_CommunitySavedPosts_CommunityPosts_PostId",
                        column: x => x.PostId,
                        principalTable: "CommunityPosts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CommunitySavedPosts_UserProfiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_CommunitySavedPosts_ProfileId",
                table: "CommunitySavedPosts",
                column: "ProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_CommunitySavedPosts_ProfileId_SavedAtUtc",
                table: "CommunitySavedPosts",
                columns: new[] { "ProfileId", "SavedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CommunitySavedPosts");
        }
    }
}
