using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProfileEngagementStreak : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EngagementStreakBestDays",
                table: "UserProfiles",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "EngagementStreakCurrentDays",
                table: "UserProfiles",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "EngagementStreakLastActiveDateUtc",
                table: "UserProfiles",
                type: "datetime(6)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EngagementStreakBestDays",
                table: "UserProfiles");

            migrationBuilder.DropColumn(
                name: "EngagementStreakCurrentDays",
                table: "UserProfiles");

            migrationBuilder.DropColumn(
                name: "EngagementStreakLastActiveDateUtc",
                table: "UserProfiles");
        }
    }
}
