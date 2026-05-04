const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const {
  completePurchase,
  getBasket,
  getBasketTotal,
} = require('./shopDatabase');

const DEFAULT_PURCHASE_CATEGORY_ID = '1499542332368879724';

async function createPurchaseTicket(interaction) {
  const basket = await getBasket(interaction.user.id);

  if (!basket || basket.length === 0) {
    return {
      ok: false,
      message: 'Your basket is empty, so there is nothing to purchase.',
    };
  }

  const total = await getBasketTotal(interaction.user.id);
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
    return `**${name}** x${data.quantity} - GBP ${itemTotal.toFixed(2)}`;
  });

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

  const purchasedItems = await completePurchase(interaction.user.id);
  const itemLines = purchasedItems.map((item) => {
    const name = item.product_name || item.productName;

    return [
      `**${name}**`,
      `Price: GBP ${Number(item.price || 0).toFixed(2)}`,
      item.robux_price ? `Robux: ${item.robux_price}` : null,
      `Code: \`${item.code}\``,
      `Image: ${item.image_url || item.imageUrl || 'None'}`,
    ]
      .filter(Boolean)
      .join('\n');
  });

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
      `Purchase Ticket\n\n` +
      `Customer: <@${interaction.user.id}>\n\n` +
      `Order Summary:\n` +
      `${summaryLines.join('\n')}\n\n` +
      `Total: GBP ${Number(total.gbp || 0).toFixed(2)}\n` +
      `Robux Total: ${Number(total.robux || 0)}\n\n` +
      `---\nDelivered Codes Below:`,
  });

  await ticketChannel.send({
    content: 'Staff controls for this ticket:',
    components: [controls],
  });

  for (const chunk of chunkLines(itemLines, 1800)) {
    await ticketChannel.send(chunk);
  }

  return {
    ok: true,
    ticketChannel,
  };
}

function chunkLines(lines, maxLength) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;

    if (next.length > maxLength) {
      if (current) {
        chunks.push(current);
      }

      current = line;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

module.exports = {
  createPurchaseTicket,
};
