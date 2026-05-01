const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PANEL_COLOR = '#2B8CFF';
const TICKET_NAME_PREFIX = 'ticket';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Create an interactive support ticket panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Where the ticket panel should be posted')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription('Optional category where new tickets should be created')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    )
    .addRoleOption((option) =>
      option
        .setName('support_role')
        .setDescription('Optional support role that can view created tickets')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const category = interaction.options.getChannel('category');
    const supportRole = interaction.options.getRole('support_role');

    const sessionId = crypto.randomBytes(8).toString('hex');
    ensureSessionStore(interaction.client);

    interaction.client.ticketPanelSessions.set(sessionId, {
      targetChannelId: targetChannel.id,
      categoryId: category?.id || '0',
      supportRoleId: supportRole?.id || '0',
      userId: interaction.user.id,
      createdAt: Date.now(),
    });

    const modal = new ModalBuilder()
      .setCustomId(`ticketpanel:modal:${sessionId}`)
      .setTitle('Ticket Panel Creator');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Panel title')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(true)
      .setPlaceholder('Support Tickets');

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Panel description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true)
      .setPlaceholder('Press the button below to open a private support ticket.');

    const buttonLabelInput = new TextInputBuilder()
      .setCustomId('buttonLabel')
      .setLabel('Ticket button label')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(80)
      .setRequired(true)
      .setPlaceholder('Create Ticket');

    const colorInput = new TextInputBuilder()
      .setCustomId('color')
      .setLabel('Panel color hex')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder(DEFAULT_PANEL_COLOR);

    const footerInput = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer text')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false)
      .setPlaceholder('Our team will be with you shortly.');

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(buttonLabelInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(footerInput)
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    const [, , sessionId] = interaction.customId.split(':');
    ensureSessionStore(interaction.client);

    const session = interaction.client.ticketPanelSessions.get(sessionId);

    if (!session || isExpired(session.createdAt)) {
      interaction.client.ticketPanelSessions.delete(sessionId);
      await interaction.reply({
        content: 'This ticket panel session expired. Run `/ticketpanel` again.',
        ephemeral: true,
      });
      return;
    }

    if (session.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'Only the creator can finish this ticket panel.',
        ephemeral: true,
      });
      return;
    }

    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const buttonLabel = interaction.fields.getTextInputValue('buttonLabel').trim();
    const colorInput = interaction.fields.getTextInputValue('color').trim();
    const footer = interaction.fields.getTextInputValue('footer').trim();

    if (colorInput && !/^#?[0-9a-fA-F]{6}$/.test(colorInput)) {
      await interaction.reply({
        content: 'The color must be a valid 6-digit hex code like `#2B8CFF`.',
        ephemeral: true,
      });
      return;
    }

    if (!buttonLabel) {
      await interaction.reply({
        content: 'The ticket button label cannot be empty.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(normalizeHex(colorInput || DEFAULT_PANEL_COLOR));

    if (footer) {
      embed.setFooter({ text: footer });
    }

    session.embedData = embed.toJSON();
    session.buttonLabel = buttonLabel;
    interaction.client.ticketPanelSessions.set(sessionId, session);

    const previewButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticketpanel:send:${sessionId}`)
        .setLabel('Post Panel')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ticketpanel:cancel:${sessionId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `Preview ready for <#${session.targetChannelId}>. Post it when it looks right.`,
      embeds: [embed],
      components: [previewButtons],
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    const [, action, ...rest] = interaction.customId.split(':');

    if (action === 'send' || action === 'cancel') {
      await handlePreviewAction(interaction, action, rest[0]);
      return;
    }

    if (action === 'open') {
      await handleOpenTicket(interaction, rest[0], rest[1]);
      return;
    }

    if (action === 'close') {
      await handleCloseTicket(interaction);
    }
  },
};

function ensureSessionStore(client) {
  if (!client.ticketPanelSessions) {
    client.ticketPanelSessions = new Map();
  }
}

function isExpired(createdAt) {
  return Date.now() - createdAt > SESSION_TTL_MS;
}

function normalizeHex(value) {
  return value.startsWith('#') ? value : `#${value}`;
}

async function handlePreviewAction(interaction, action, sessionId) {
  ensureSessionStore(interaction.client);
  const sessions = interaction.client.ticketPanelSessions;
  const session = sessions.get(sessionId);

  if (!session || isExpired(session.createdAt)) {
    sessions.delete(sessionId);
    await interaction.update({
      content: 'This ticket panel session expired. Run `/ticketpanel` again.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (session.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'Only the creator can use these controls.',
      ephemeral: true,
    });
    return;
  }

  if (action === 'cancel') {
    sessions.delete(sessionId);
    await interaction.update({
      content: 'Ticket panel creation cancelled.',
      embeds: [],
      components: [],
    });
    return;
  }

  const targetChannel = await interaction.client.channels.fetch(session.targetChannelId);

  if (!targetChannel || !targetChannel.isTextBased()) {
    sessions.delete(sessionId);
    await interaction.update({
      content: 'The target channel could not be found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const liveButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticketpanel:open:${session.categoryId}:${session.supportRoleId}`)
      .setLabel(session.buttonLabel)
      .setStyle(ButtonStyle.Primary)
  );

  await targetChannel.send({
    embeds: [EmbedBuilder.from(session.embedData)],
    components: [liveButtons],
  });

  sessions.delete(sessionId);

  await interaction.update({
    content: `Ticket panel posted successfully in <#${targetChannel.id}>.`,
    embeds: [],
    components: [],
  });
}

async function handleOpenTicket(interaction, categoryId, supportRoleId) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'Tickets can only be opened inside a server.',
      ephemeral: true,
    });
    return;
  }

  const guild = interaction.guild;
  const existingChannel = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.topic &&
      channel.topic.includes(`Ticket owner: ${interaction.user.id}`)
  );

  if (existingChannel) {
    await interaction.reply({
      content: `You already have an open ticket: ${existingChannel}`,
      ephemeral: true,
    });
    return;
  }

  const safeName =
    interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || 'user';

  const permissionOverwrites = [
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
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
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
  ];

  if (supportRoleId && supportRoleId !== '0') {
    permissionOverwrites.push({
      id: supportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const ticketChannel = await guild.channels.create({
    name: `${TICKET_NAME_PREFIX}-${safeName}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: categoryId && categoryId !== '0' ? categoryId : null,
    topic: `Ticket owner: ${interaction.user.id} | Created from panel message ${interaction.message.id}`,
    permissionOverwrites,
  });

  const closeControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticketpanel:close')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );

  const supportMention =
    supportRoleId && supportRoleId !== '0' ? `<@&${supportRoleId}> ` : '';

  await ticketChannel.send({
    content:
      `${supportMention}<@${interaction.user.id}> your ticket is ready.\n` +
      'Describe what you need and a staff member will help you shortly.',
    components: [closeControls],
  });

  await interaction.reply({
    content: `Your ticket has been created: ${ticketChannel}`,
    ephemeral: true,
  });
}

async function handleCloseTicket(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This button can only be used inside a server ticket.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: 'Only staff can close tickets.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: 'Closing ticket...',
  });

  await interaction.channel.delete();
}
