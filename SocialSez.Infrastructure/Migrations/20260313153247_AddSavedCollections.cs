using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSavedCollections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SavedCollections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ProfileId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    Name = table.Column<string>(type: "varchar(100)", maxLength: 100, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedCollections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SavedCollections_UserProfiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "SavedItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ProfileId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ItemType = table.Column<string>(type: "varchar(8)", maxLength: 8, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    PostId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    ReelId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    SavedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SavedItems_Posts_PostId",
                        column: x => x.PostId,
                        principalTable: "Posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SavedItems_Reels_ReelId",
                        column: x => x.ReelId,
                        principalTable: "Reels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SavedItems_UserProfiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "SavedCollectionItems",
                columns: table => new
                {
                    CollectionId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    SavedItemId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    AddedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedCollectionItems", x => new { x.CollectionId, x.SavedItemId });
                    table.ForeignKey(
                        name: "FK_SavedCollectionItems_SavedCollections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "SavedCollections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SavedCollectionItems_SavedItems_SavedItemId",
                        column: x => x.SavedItemId,
                        principalTable: "SavedItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_SavedCollectionItems_SavedItemId",
                table: "SavedCollectionItems",
                column: "SavedItemId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedCollections_ProfileId",
                table: "SavedCollections",
                column: "ProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedItems_PostId",
                table: "SavedItems",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedItems_ProfileId",
                table: "SavedItems",
                column: "ProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedItems_ProfileId_PostId",
                table: "SavedItems",
                columns: new[] { "ProfileId", "PostId" },
                unique: true,
                filter: "PostId IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SavedItems_ProfileId_ReelId",
                table: "SavedItems",
                columns: new[] { "ProfileId", "ReelId" },
                unique: true,
                filter: "ReelId IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_SavedItems_ProfileId_SavedAtUtc",
                table: "SavedItems",
                columns: new[] { "ProfileId", "SavedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_SavedItems_ReelId",
                table: "SavedItems",
                column: "ReelId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SavedCollectionItems");

            migrationBuilder.DropTable(
                name: "SavedCollections");

            migrationBuilder.DropTable(
                name: "SavedItems");
        }
    }
}
