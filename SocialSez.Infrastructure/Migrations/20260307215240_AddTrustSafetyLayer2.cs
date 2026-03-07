using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTrustSafetyLayer2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CommunityBanAppeals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    CommunityId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ProfileId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    Reason = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Status = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ResolutionNote = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ReviewedByProfileId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    ReviewedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommunityBanAppeals", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CommunityBanAppeals_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CommunityBanAppeals_UserProfiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CommunityBanAppeals_UserProfiles_ReviewedByProfileId",
                        column: x => x.ReviewedByProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "CommunityModerationSettings",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    RulePreset = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    KeywordFiltersJson = table.Column<string>(type: "varchar(4000)", maxLength: 4000, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    AutoModerationEnabled = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    SpamThreshold = table.Column<int>(type: "int", nullable: false),
                    LinkRiskThreshold = table.Column<int>(type: "int", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommunityModerationSettings", x => x.CommunityId);
                    table.ForeignKey(
                        name: "FK_CommunityModerationSettings_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "CommunityShadowMutes",
                columns: table => new
                {
                    CommunityId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    ProfileId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    CreatedByProfileId = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    Reason = table.Column<string>(type: "varchar(300)", maxLength: 300, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommunityShadowMutes", x => new { x.CommunityId, x.ProfileId });
                    table.ForeignKey(
                        name: "FK_CommunityShadowMutes_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CommunityShadowMutes_UserProfiles_CreatedByProfileId",
                        column: x => x.CreatedByProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CommunityShadowMutes_UserProfiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "ModerationQueueItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false, collation: "ascii_general_ci"),
                    CommunityId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    ReporterId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    TargetProfileId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    SourceEntityId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    SourceType = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    TriggerType = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    SpamScore = table.Column<int>(type: "int", nullable: false),
                    LinkRiskScore = table.Column<int>(type: "int", nullable: false),
                    RiskScore = table.Column<int>(type: "int", nullable: false),
                    LinkUrl = table.Column<string>(type: "varchar(2048)", maxLength: 2048, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    MatchedKeyword = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ContentSnippet = table.Column<string>(type: "varchar(500)", maxLength: 500, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Status = table.Column<string>(type: "varchar(24)", maxLength: 24, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Resolution = table.Column<string>(type: "varchar(32)", maxLength: 32, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ResolutionNote = table.Column<string>(type: "varchar(1000)", maxLength: 1000, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ReviewedByProfileId = table.Column<Guid>(type: "char(36)", nullable: true, collation: "ascii_general_ci"),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    ReviewedAtUtc = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ModerationQueueItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ModerationQueueItems_Communities_CommunityId",
                        column: x => x.CommunityId,
                        principalTable: "Communities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ModerationQueueItems_UserProfiles_ReporterId",
                        column: x => x.ReporterId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ModerationQueueItems_UserProfiles_ReviewedByProfileId",
                        column: x => x.ReviewedByProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ModerationQueueItems_UserProfiles_TargetProfileId",
                        column: x => x.TargetProfileId,
                        principalTable: "UserProfiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_CommunityBanAppeals_CommunityId_Status_CreatedAtUtc",
                table: "CommunityBanAppeals",
                columns: new[] { "CommunityId", "Status", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CommunityBanAppeals_ProfileId_CreatedAtUtc",
                table: "CommunityBanAppeals",
                columns: new[] { "ProfileId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CommunityBanAppeals_ReviewedByProfileId",
                table: "CommunityBanAppeals",
                column: "ReviewedByProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_CommunityShadowMutes_CommunityId_ExpiresAtUtc",
                table: "CommunityShadowMutes",
                columns: new[] { "CommunityId", "ExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CommunityShadowMutes_CreatedByProfileId",
                table: "CommunityShadowMutes",
                column: "CreatedByProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_CommunityShadowMutes_ProfileId",
                table: "CommunityShadowMutes",
                column: "ProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_ModerationQueueItems_CommunityId_Status_CreatedAtUtc",
                table: "ModerationQueueItems",
                columns: new[] { "CommunityId", "Status", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ModerationQueueItems_ReporterId",
                table: "ModerationQueueItems",
                column: "ReporterId");

            migrationBuilder.CreateIndex(
                name: "IX_ModerationQueueItems_ReviewedByProfileId",
                table: "ModerationQueueItems",
                column: "ReviewedByProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_ModerationQueueItems_Status_CreatedAtUtc",
                table: "ModerationQueueItems",
                columns: new[] { "Status", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ModerationQueueItems_TargetProfileId",
                table: "ModerationQueueItems",
                column: "TargetProfileId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CommunityBanAppeals");

            migrationBuilder.DropTable(
                name: "CommunityModerationSettings");

            migrationBuilder.DropTable(
                name: "CommunityShadowMutes");

            migrationBuilder.DropTable(
                name: "ModerationQueueItems");
        }
    }
}
