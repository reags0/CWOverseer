const {
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Times out a member.')
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The member to timeout')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('How long the timeout should last')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('target');
    const minutes = interaction.options.getInteger('minutes');

    await interaction.reply(
      `Prepared moderation action: timeout ${target.tag} for ${minutes} minute(s).`
    );
  },
};
