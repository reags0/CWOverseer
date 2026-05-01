const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { completePurchase, getBasket } = require('../../utils/shopDatabase');

const DEFAULT_PURCHASE_CATEGORY_ID = '1499542332368879724';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Create a purchase ticket with the codes in your basket.'),

  async execute(interaction) {
    const basket = getBasket(interaction.user.id);

    if (basket.length === 0) {
      await interaction.reply({
        content: 'Your basket is empty, so there is nothing to purchase.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const safeName = interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || 'customer';

    const ticketChannel = await guild.channels.create({
      name: `purchase-${safeName}`,
      type: ChannelType.GuildText,
      parent: process.env.PURCHASE_CATEGORY_ID || DEFAULT_PURCHASE_CATEGORY_ID,
      topic: `Purchase ticket for ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    const purchasedItems = completePurchase(interaction.user.id);

    const lines = purchasedItems.map(
      (item) =>
        `**${item.productName}**\nItem Image: ${item.imageUrl || 'None'}\nCode: \`${item.code}\``
    );

    const chunks = chunkLines(lines, 1800);
    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`purchase:claim:${interaction.user.id}`)
        .setLabel('Claim Ticket')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`purchase:close:${interaction.user.id}`)
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send(
      `Purchase ticket for <@${interaction.user.id}>.\n` +
        `The following basket codes were delivered in this ticket:`
    );

    await ticketChannel.send({
      content: 'Staff controls for this ticket:',
      components: [controls],
    });

    for (const chunk of chunks) {
      await ticketChannel.send(chunk);
    }

    await interaction.editReply({
      content: `Purchase ticket created successfully: ${ticketChannel}`,
    });
  },

  async handleButton(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This button can only be used inside a server ticket channel.',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({
        content: 'Only staff members can use ticket controls.',
        ephemeral: true,
      });
      return;
    }

    const [, action] = interaction.customId.split(':');
    const channel = interaction.channel;

    if (action === 'claim') {
      const alreadyClaimed = channel.topic?.includes('Claimed by:');

      if (alreadyClaimed) {
        await interaction.reply({
          content: `This ticket is already claimed.\n${channel.topic}`,
          ephemeral: true,
        });
        return;
      }

      const updatedTopic = `${channel.topic || 'Purchase ticket'} | Claimed by: ${interaction.user.tag} (${interaction.user.id})`;
      let updatedName = channel.name;

      if (!updatedName.startsWith('claimed-')) {
        updatedName = `claimed-${updatedName}`.slice(0, 100);
      }

      await channel.edit({
        name: updatedName,
        topic: updatedTopic,
      });

      await interaction.reply({
        content: `${interaction.user} claimed this ticket.`,
      });
      return;
    }

    if (action === 'close') {
      await interaction.reply({
        content: `Closing ticket by request of ${interaction.user}...`,
      });

      await channel.delete('Purchase ticket closed by staff');
    }
  },
};

function chunkLines(lines, maxLength) {
  const chunks = [];
  let currentChunk = '';

  for (const line of lines) {
    const candidate = currentChunk ? `${currentChunk}\n\n${line}` : line;

    if (candidate.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      currentChunk = line;
      continue;
    }

    currentChunk = candidate;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
