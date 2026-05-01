const { SlashCommandBuilder } = require('discord.js');
const { getInviteCount, refreshGuildInvites } = require('../../utils/inviteTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Show how many invites a user has.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Optional user to check')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (!interaction.client.inviteCache?.has(interaction.guild.id)) {
      await refreshGuildInvites(interaction.guild, interaction.client);
    }

    const inviteCount = getInviteCount(
      interaction.client,
      interaction.guild.id,
      targetUser.id
    );

    await interaction.reply({
      content: `${targetUser} currently has **${inviteCount}** tracked invite(s).`,
      ephemeral: false,
    });
  },
};
