const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  addCode,
  deleteCode,
  getCodes,
  getProductSummary,
  getStockSummary,
} = require('../../utils/shopDatabase');

function parsePrice(input) {
  if (!input) return NaN;
  const normalized = input.replace(',', '.');
  const number = parseFloat(normalized);
  return isNaN(number) ? NaN : number;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shopadmin')
    .setDescription('Manage shop stock codes.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand((subcommand) =>
      subcommand
        .setName('addcode')
        .setDescription('Add a stock code to the shop database.')
        .addStringOption((option) =>
          option.setName('product').setDescription('The product name').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('code').setDescription('The stock code').setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('price')
            .setDescription('Price (e.g. 1.25 or 1,25)')
            .setRequired(true)
        )
        .addAttachmentOption((option) =>
          option.setName('image').setDescription('Optional image').setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName('one_time')
            .setDescription('Consume after purchase')
            .setRequired(false)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName('stock')
        .setDescription('View stock')
        .addStringOption((option) =>
          option.setName('product').setDescription('Optional product').setRequired(false)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName('viewcodes')
        .setDescription('View stored codes')
        .addStringOption((option) =>
          option.setName('product').setDescription('Optional filter').setRequired(false)
        )
    )

    .addSubcommand((subcommand) =>
      subcommand
        .setName('deletecode')
        .setDescription('Delete a stored code')
        .addStringOption((option) =>
          option.setName('item_id').setDescription('Item ID').setRequired(true)
        )
    ),

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();

      //
      // ✅ ADD CODE
      //
      if (subcommand === 'addcode') {
        const productName = interaction.options.getString('product');
        const code = interaction.options.getString('code');
        const priceInput = interaction.options.getString('price');
        const image = interaction.options.getAttachment('image');
        const oneTime = interaction.options.getBoolean('one_time') || false;

        const price = parsePrice(priceInput);

        if (isNaN(price) || price < 0) {
          await interaction.reply({
            content: 'Invalid price. Use `1.25` or `1,25`',
            ephemeral: true,
          });
          return;
        }

        const item = await addCode(
          productName,
          code,
          interaction.user.id,
          oneTime,
          image?.url || null,
          price
        );

        await interaction.reply({
          content:
            `Stored ${item.oneTime ? 'one-time' : 'reusable'} code for **${item.productName}**\n` +
            `💰 Price: £${item.price.toFixed(2)}\n` +
            `Item ID: \`${item.id}\`\n` +
            `Item Image: ${item.imageUrl || 'None'}`,
          ephemeral: true,
        });
        return;
      }

      //
      // ✅ STOCK
      //
      if (subcommand === 'stock') {
        const productName = interaction.options.getString('product');

        if (productName) {
          const summary = await getProductSummary(productName);

          if (!summary) {
            await interaction.reply({
              content: 'Product not found.',
              ephemeral: true,
            });
            return;
          }

          await interaction.reply({
            content:
              `**${summary.productName}** stock\n` +
              `Total: ${summary.total}\n` +
              `Available: ${summary.available}\n` +
              `Reserved: ${summary.reserved}\n` +
              `Reusable: ${summary.reusable}\n` +
              `One-time: ${summary.oneTime}`,
            ephemeral: true,
          });
          return;
        }

        const stock = await getStockSummary();

        if (!stock || stock.length === 0) {
          await interaction.reply({
            content: 'Database is empty.',
            ephemeral: true,
          });
          return;
        }

        const lines = stock.map(
          (entry) =>
            `**${entry.productName}**: ${entry.available} available, ${entry.reserved} reserved`
        );

        await interaction.reply({
          content: lines.join('\n'),
          ephemeral: true,
        });
        return;
      }

      //
      // ✅ VIEW CODES (MAIN ISSUE WAS HERE)
      //
      if (subcommand === 'viewcodes') {
        const productName = interaction.options.getString('product');

        const codes = await getCodes(productName);

        // ✅ FIX: handle undefined/null safely
        if (!codes || codes.length === 0) {
          await interaction.reply({
            content: 'No codes found.',
            ephemeral: true,
          });
          return;
        }

        const lines = codes.map((item) => {
          const name = item.product_name || item.productName || 'Unknown';

          return (
            `**${name}** | £${Number(item.price || 0).toFixed(2)} | ` +
            `\`${item.id}\` | \`${item.code}\` | ${item.status}`
          );
        });

        await interaction.reply({
          content: lines.join('\n').slice(0, 1900),
          ephemeral: true,
        });

        return;
      }

      //
      // ✅ DELETE
      //
      if (subcommand === 'deletecode') {
        const itemId = interaction.options.getString('item_id');

        const removedItem = await deleteCode(itemId);

        if (!removedItem) {
          await interaction.reply({
            content: `No code found with ID \`${itemId}\``,
            ephemeral: true,
          });
          return;
        }

        const name = removedItem.product_name || removedItem.productName || 'Unknown';

        await interaction.reply({
          content:
            `Deleted **${name}**\n` +
            `Code: \`${removedItem.code}\``,
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error('SHOPADMIN ERROR:', err);

      if (!interaction.replied) {
        await interaction.reply({
          content: '❌ There was an error running this command.',
          ephemeral: true,
        });
      }
    }
  },
};
