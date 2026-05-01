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

    // Group items
    const grouped = {};

    for (const item of basket) {
      const name = item.product_name || item.productName;

      if (!grouped[name]) {
        grouped[name] = {
          quantity: 0,
          price: Number(item.price || 0),
        };
      }

      grouped[name].quantity += 1;
    }

    const summaryLines = Object.entries(grouped).map(([name, data]) => {
      const itemTotal = data.price * data.quantity;
      return `**${name}** x${data.quantity} - £${itemTotal.toFixed(2)}`;
    });

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;

    const safeName =
      interaction.user.username
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
      const name = item.product_name || item.productName;

      return [
        `**${name}**`,
        `💰 £${Number(item.price || 0).toFixed(2)}`,
        item.robux_price ? `🟩 ${item.robux_price} Robux` : null,
        `Code: \`${item.code}\``,
        `Image: ${item.image_url || item.imageUrl || 'None'}`
      ]
        .filter(Boolean)
        .join('\n');
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

    await ticketChannel.send({
      content:
        `🧾 **Purchase Ticket**\n\n` +
        `👤 Customer: <@${interaction.user.id}>\n\n` +
        `🛒 **Order Summary:**\n` +
        `${summaryLines.join('\n')}\n\n` +
        `💰 **Total: £${Number(total.gbp || 0).toFixed(2)}**` +
        (total.robux ? `\n🟩 **Robux Total: ${total.robux}**` : '') +
        `\n\n---\n📦 **Delivered Codes Below:**`,
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
        content: 'This button can only be used inside a server.',
        ephemeral: true,
      });
    }

    if (
      !interaction.memberPermissions.has(
        PermissionFlagsBits.ManageChannels
      )
    ) {
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
        content: `Closing ticket...`,
      });

      await channel.delete();
    }
  },
};

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
