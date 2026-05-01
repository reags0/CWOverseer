const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const SESSION_TTL_MS = 15 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embedbuilder')
    .setDescription('Open an interactive popup to build an embed.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('embedbuilder:modal')
      .setTitle('Interactive Embed Builder');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Embed title')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(false);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true);

    const colorInput = new TextInputBuilder()
      .setCustomId('color')
      .setLabel('Color hex')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('#5865F2')
      .setRequired(false);

    const footerInput = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer text')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false);

    const imageInput = new TextInputBuilder()
      .setCustomId('image')
      .setLabel('Image URL')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(footerInput),
      new ActionRowBuilder().addComponents(imageInput)
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields
      .getTextInputValue('description')
      .trim();
    const colorInput = interaction.fields.getTextInputValue('color').trim();
    const footer = interaction.fields.getTextInputValue('footer').trim();
    const image = interaction.fields.getTextInputValue('image').trim();

    if (colorInput && !/^#?[0-9a-fA-F]{6}$/.test(colorInput)) {
      await interaction.reply({
        content: 'The color must be a valid 6-digit hex code like `#5865F2`.',
        ephemeral: true,
      });
      return;
    }

    if (image && !isValidUrl(image)) {
      await interaction.reply({
        content: 'The image field must be a valid URL.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder().setDescription(description);

    if (title) {
      embed.setTitle(title);
    }

    if (colorInput) {
      embed.setColor(normalizeHex(colorInput));
    }

    if (footer) {
      embed.setFooter({ text: footer });
    }

    if (image) {
      embed.setImage(image);
    }

    const sessionId = crypto.randomBytes(8).toString('hex');

    interaction.client.embedBuilderSessions.set(sessionId, {
      channelId: interaction.channelId,
      createdAt: Date.now(),
      embedData: embed.toJSON(),
      userId: interaction.user.id,
    });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`embedbuilder:send:${sessionId}`)
        .setLabel('Send Embed')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`embedbuilder:cancel:${sessionId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: 'Here is your embed preview. Send it when it looks right.',
      embeds: [embed],
      components: [buttons],
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    const [, action, sessionId] = interaction.customId.split(':');
    const session = interaction.client.embedBuilderSessions.get(sessionId);

    if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
      interaction.client.embedBuilderSessions.delete(sessionId);
      await interaction.update({
        content: 'This embed session expired. Run `/embedbuilder` to start again.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (session.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'Only the person who opened this embed builder can use these buttons.',
        ephemeral: true,
      });
      return;
    }

    if (action === 'cancel') {
      interaction.client.embedBuilderSessions.delete(sessionId);
      await interaction.update({
        content: 'Embed builder cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (action === 'send') {
      const channel = await interaction.client.channels.fetch(session.channelId);

      if (!channel || !channel.isTextBased()) {
        interaction.client.embedBuilderSessions.delete(sessionId);
        await interaction.update({
          content: 'I could not find a text channel to send the embed to.',
          embeds: [],
          components: [],
        });
        return;
      }

      await channel.send({
        embeds: [EmbedBuilder.from(session.embedData)],
      });

      interaction.client.embedBuilderSessions.delete(sessionId);
      await interaction.update({
        content: 'Embed sent successfully.',
        embeds: [],
        components: [],
      });
    }
  },
};

function normalizeHex(value) {
  return value.startsWith('#') ? value : `#${value}`;
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
