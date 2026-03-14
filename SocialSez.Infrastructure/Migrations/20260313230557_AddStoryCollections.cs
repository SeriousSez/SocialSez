using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddStoryCollections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StoryCollections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ProfileId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    Name = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoryCollections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoryCollections_UserProfiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "StoryCollectionItems",
                columns: table => new
                {
                    CollectionId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    StoryId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    AddedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoryCollectionItems", x => new { x.CollectionId, x.StoryId });
                    table.ForeignKey(
                        name: "FK_StoryCollectionItems_Stories_StoryId",
                        column: x => x.StoryId,
                        principalTable: "Stories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StoryCollectionItems_StoryCollections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "StoryCollections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_StoryCollectionItems_CollectionId_AddedAtUtc",
                table: "StoryCollectionItems",
                columns: new[] { "CollectionId", "AddedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_StoryCollectionItems_StoryId",
                table: "StoryCollectionItems",
                column: "StoryId");

            migrationBuilder.CreateIndex(
                name: "IX_StoryCollections_ProfileId_CreatedAtUtc",
                table: "StoryCollections",
                columns: new[] { "ProfileId", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StoryCollectionItems");

            migrationBuilder.DropTable(
                name: "StoryCollections");
        }
    }
}
