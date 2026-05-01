const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bans a member from the server.')
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The member to ban')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Why the user is being banned')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('target');
    const reason =
      interaction.options.getString('reason') || 'No reason provided.';

    await interaction.reply(
      `Prepared moderation action: ban ${target.tag} for "${reason}".`
    );
  },
};
