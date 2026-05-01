const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const {
  completePurchase,
  getBasket,
  getBasketTotal,
} = require('../../utils/shopDatabase');

const DEFAULT_PURCHASE_CATEGORY_ID = '1499542332368879724';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Create a purchase ticket with the codes in your basket.'),

  async execute(interaction) {
    const basket = await getBasket(interaction.user.id);

    if (!basket || basket.length === 0) {
      return interaction.reply({
        content: 'Your basket is empty, so there is nothing to purchase.',
        ephemeral: true,
      });
    }

    const total = await getBasketTotal(interaction.user.id);

    // ✅ GROUP ITEMS
    const grouped = {};

    for (const item of basket) {
      const name = item.productName || item.product_name || 'Unknown';

      if (!grouped[name]) {
        grouped[name] = {
          quantity: 0,
          price: item.price || 0,
        };
      }

      grouped[name].quantity += 1;
    }

    // ✅ FIXED MAP (this was your crash area)
    const summaryLines = Object.entries(grouped).map(([name, data]) => {
      const itemTotal = (data.price || 0) * data.quantity;
      return `**${name}** x${data.quantity} - £${itemTotal.toFixed(2)}`;
    });

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
      parent:
        process.env.PURCHASE_CATEGORY_ID ||
        DEFAULT_PURCHASE_CATEGORY_ID,
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

    const purchasedItems = await completePurchase(interaction.user.id);

    const itemLines = purchasedItems.map((item) => {
      const name = item.productName || item.product_name || 'Unknown';

      return (
        `**${name}**\n` +
        `💰 £${(item.price || 0).toFixed(2)}\n` +
        `Code: \`${item.code}\`\n` +
        `Image: ${item.imageUrl || 'None'}`
      );
    });

    const chunks = chunkLines(itemLines, 1800);

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

    // ✅ SUMMARY MESSAGE
    await ticketChannel.send({
      content:
        `🧾 **Purchase Ticket**\n\n` +
        `👤 Customer: <@${interaction.user.id}>\n\n` +
        `🛒 **Order Summary:**\n` +
        `${summaryLines.join('\n')}\n\n` +
        `💰 **Total: £${total.toFixed(2)}**\n\n` +
        `---\n📦 **Delivered Codes Below:**`,
    });

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
      return interaction.reply({
        content: 'This button can only be used inside a server ticket channel.',
        ephemeral: true,
      });
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: 'Only staff members can use ticket controls.',
        ephemeral: true,
      });
    }

    const [, action] = interaction.customId.split(':');
    const channel = interaction.channel;

    if (action === 'claim') {
      if (channel.topic?.includes('Claimed by:')) {
        return interaction.reply({
          content: `This ticket is already claimed.\n${channel.topic}`,
          ephemeral: true,
        });
      }

      const updatedTopic =
        `${channel.topic || 'Purchase ticket'} | Claimed by: ` +
        `${interaction.user.tag} (${interaction.user.id})`;

      let updatedName = channel.name;
      if (!updatedName.startsWith('claimed-')) {
        updatedName = `claimed-${updatedName}`.slice(0, 100);
      }

      await channel.edit({
        name: updatedName,
        topic: updatedTopic,
      });

      return interaction.reply({
        content: `${interaction.user} claimed this ticket.`,
      });
    }

    if (action === 'close') {
      await interaction.reply({
        content: `Closing ticket by request of ${interaction.user}...`,
      });

      await channel.delete('Purchase ticket closed by staff');
    }
  },
};

// ✅ helper
function chunkLines(lines, maxLength) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;

    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}
