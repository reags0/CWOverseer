const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const { createPurchaseTicket } = require('../../utils/purchaseTicket');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Create a purchase ticket with the codes in your basket.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await createPurchaseTicket(interaction);

    if (!result.ok) {
      return interaction.editReply({
        content: result.message,
      });
    }

    await interaction.editReply({
      content: `Purchase ticket created successfully: ${result.ticketChannel}`,
    });
  },

  async handleButton(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'This button can only be used inside a server.',
        ephemeral: true,
      });
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: 'Only staff can use ticket controls.',
        ephemeral: true,
      });
    }

    const [, action] = interaction.customId.split(':');
    const channel = interaction.channel;

    if (action === 'claim') {
      const alreadyClaimed = channel.topic?.includes('Claimed by:');

      if (alreadyClaimed) {
        return interaction.reply({
          content: `Already claimed.\n${channel.topic}`,
          ephemeral: true,
        });
      }

      await channel.edit({
        name: channel.name.startsWith('claimed-')
          ? channel.name
          : `claimed-${channel.name}`,
        topic: `${channel.topic} | Claimed by: ${interaction.user.tag}`,
      });

      return interaction.reply({
        content: `${interaction.user} claimed this ticket.`,
      });
    }

    if (action === 'close') {
      await interaction.reply({
        content: 'Closing ticket...',
      });

      await channel.delete();
    }
  },
};
