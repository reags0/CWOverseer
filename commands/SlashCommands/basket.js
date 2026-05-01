const { SlashCommandBuilder } = require('discord.js');
const {
  addToBasket,
  clearBasket,
  getBasket,
  removeFromBasket,
} = require('../../utils/shopDatabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('basket')
    .setDescription('Manage your reserved shop codes.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Reserve one specific stored code and add it to your basket.')
        .addStringOption((option) =>
          option
            .setName('code')
            .setDescription('The exact code you want to reserve')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View the codes currently in your basket.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove one reserved code from your basket.')
        .addStringOption((option) =>
          option
            .setName('code')
            .setDescription('The exact code to remove from your basket')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear')
        .setDescription('Remove every reserved code from your basket.')
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const code = interaction.options.getString('code');
      const item = addToBasket(userId, code);

      if (item === 'duplicate') {
        await interaction.reply({
          content: 'That code is already in your basket.',
          ephemeral: true,
        });
        return;
      }

      if (item === false) {
        await interaction.reply({
          content: 'That one-time code is already reserved in someone else\'s basket.',
          ephemeral: true,
        });
        return;
      }

      if (!item) {
        await interaction.reply({
          content: 'That stored code was not found.',
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content:
          `Added **${item.productName}** to your basket.\n` +
          `Item Image: ${item.imageUrl || 'None'}\n` +
          `Code: \`${item.code}\``,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'view') {
      const basket = getBasket(userId);

      if (basket.length === 0) {
        await interaction.reply({
          content: 'Your basket is empty.',
          ephemeral: true,
        });
        return;
      }

      const lines = basket.map(
        (item) =>
          `**${item.productName}**\nItem Image: ${item.imageUrl || 'None'}\nCode: \`${item.code}\``
      );

      await interaction.reply({
        content: lines.join('\n\n'),
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'remove') {
      const code = interaction.options.getString('code');
      const item = removeFromBasket(userId, code);

      if (!item) {
        await interaction.reply({
          content: 'That code was not found in your basket.',
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `Removed **${item.productName}** from your basket.`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'clear') {
      const removedCount = clearBasket(userId);

      await interaction.reply({
        content: `Cleared ${removedCount} item(s) from your basket.`,
        ephemeral: true,
      });
    }
  },
};
