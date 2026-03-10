using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialSez.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddChatConversationMemberMute : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsMuted",
                table: "ChatConversationMembers",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsMuted",
                table: "ChatConversationMembers");
        }
    }
}
