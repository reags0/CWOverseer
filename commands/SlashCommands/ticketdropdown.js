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
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PANEL_COLOR = '#2B8CFF';
const TICKET_NAME_PREFIX = 'ticket';
const MAX_SELECT_OPTIONS = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketdropdown')
    .setDescription('Create an interactive dropdown ticket panel.')
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
    const sessions = ensureStore(interaction.client);

    sessions.set(sessionId, {
      targetChannelId: targetChannel.id,
      categoryId: category?.id || '0',
      supportRoleId: supportRole?.id || '0',
      userId: interaction.user.id,
      createdAt: Date.now(),
    });

    const modal = new ModalBuilder()
      .setCustomId(`ticketdropdown:modal:${sessionId}`)
      .setTitle('Dropdown Ticket Panel');

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
      .setPlaceholder('Choose a reason below to open a private support ticket.');

    const placeholderInput = new TextInputBuilder()
      .setCustomId('placeholder')
      .setLabel('Dropdown placeholder')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(150)
      .setRequired(true)
      .setPlaceholder('Select a ticket type');

    const optionsInput = new TextInputBuilder()
      .setCustomId('options')
      .setLabel('Options (one per line: Label | Description)')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true)
      .setPlaceholder('Billing | Payment help\nSupport | General help\nAppeal | Appeal a punishment');

    const footerInput = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer / color (Footer text | #hex)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false)
      .setPlaceholder('Our team will be with you shortly. | #2B8CFF');

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(placeholderInput),
      new ActionRowBuilder().addComponents(optionsInput),
      new ActionRowBuilder().addComponents(footerInput)
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    const [, , sessionId] = interaction.customId.split(':');
    const sessions = ensureStore(interaction.client);
    const session = sessions.get(sessionId);

    if (!session || isExpired(session.createdAt)) {
      sessions.delete(sessionId);
      await interaction.reply({
        content: 'This dropdown ticket panel session expired. Run `/ticketdropdown` again.',
        ephemeral: true,
      });
      return;
    }

    if (session.userId !== interaction.user.id) {
      await interaction.reply({
        content: 'Only the creator can finish this dropdown ticket panel.',
        ephemeral: true,
      });
      return;
    }

    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const placeholder = interaction.fields.getTextInputValue('placeholder').trim();
    const rawOptions = interaction.fields.getTextInputValue('options');
    const footerAndColor = interaction.fields.getTextInputValue('footer').trim();
    const { footer, color } = parseFooterAndColor(footerAndColor);

    if (color && !/^#?[0-9a-fA-F]{6}$/.test(color)) {
      await interaction.reply({
        content: 'The color must be a valid 6-digit hex code like `#2B8CFF`.',
        ephemeral: true,
      });
      return;
    }

    const parsedOptions = parseDropdownOptions(rawOptions);

    if (parsedOptions.error) {
      await interaction.reply({
        content: parsedOptions.error,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(normalizeHex(color || DEFAULT_PANEL_COLOR));

    if (footer) {
      embed.setFooter({ text: footer });
    }

    session.embedData = embed.toJSON();
    session.placeholder = placeholder;
    session.options = parsedOptions.options;
    sessions.set(sessionId, session);

    await interaction.reply({
      content: `Preview ready for <#${session.targetChannelId}>. Post it when it looks right.`,
      embeds: [embed],
      components: [
        buildPreviewSelectMenu(sessionId, session.placeholder, session.options),
        buildPreviewButtons(sessionId),
      ],
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    const [, action, sessionId] = interaction.customId.split(':');

    if (action === 'send' || action === 'cancel') {
      await handlePreviewAction(interaction, action, sessionId);
    }
  },

  async handleSelectMenu(interaction) {
    const [, action, categoryId, supportRoleId] = interaction.customId.split(':');

    if (action !== 'open') {
      return;
    }

    await handleOpenTicket(interaction, categoryId, supportRoleId, interaction.values[0]);
  },
};

function ensureStore(client) {
  if (!client.ticketDropdownSessions) {
    client.ticketDropdownSessions = new Map();
  }

  return client.ticketDropdownSessions;
}

function isExpired(createdAt) {
  return Date.now() - createdAt > SESSION_TTL_MS;
}

function normalizeHex(value) {
  return value.startsWith('#') ? value : `#${value}`;
}

function parseFooterAndColor(value) {
  if (!value) {
    return { footer: '', color: '' };
  }

  const parts = value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { footer: '', color: '' };
  }

  if (parts.length === 1) {
    if (/^#?[0-9a-fA-F]{6}$/.test(parts[0])) {
      return { footer: '', color: parts[0] };
    }

    return { footer: parts[0], color: '' };
  }

  return {
    footer: parts[0],
    color: parts[1],
  };
}

function parseDropdownOptions(value) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { error: 'Add at least one dropdown option.' };
  }

  if (lines.length > MAX_SELECT_OPTIONS) {
    return { error: `You can add up to ${MAX_SELECT_OPTIONS} dropdown options per panel.` };
  }

  const options = [];
  const seenLabels = new Set();

  for (const line of lines) {
    const [labelPart, descriptionPart] = line.split('|').map((part) => part.trim());
    const label = labelPart || '';

    if (!label) {
      return {
        error: 'Each dropdown option needs a label. Use `Label | Description` on each line.',
      };
    }

    if (label.length > 100) {
      return {
        error: `Dropdown labels must be 100 characters or fewer. Problem label: \`${label}\``,
      };
    }

    if (seenLabels.has(label.toLowerCase())) {
      return {
        error: `Duplicate dropdown label found: \`${label}\`. Each option label must be unique.`,
      };
    }

    seenLabels.add(label.toLowerCase());
    options.push({
      label,
      value: label,
      description: descriptionPart ? descriptionPart.slice(0, 100) : undefined,
    });
  }

  return { options };
}

function buildPreviewSelectMenu(sessionId, placeholder, options) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticketdropdown:preview:${sessionId}`)
      .setPlaceholder(placeholder)
      .setDisabled(true)
      .addOptions(options)
  );
}

function buildPreviewButtons(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticketdropdown:send:${sessionId}`)
      .setLabel('Post Panel')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticketdropdown:cancel:${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function handlePreviewAction(interaction, action, sessionId) {
  const sessions = ensureStore(interaction.client);
  const session = sessions.get(sessionId);

  if (!session || isExpired(session.createdAt)) {
    sessions.delete(sessionId);
    await interaction.update({
      content: 'This dropdown ticket panel session expired. Run `/ticketdropdown` again.',
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
      content: 'Dropdown ticket panel creation cancelled.',
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

  const liveMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticketdropdown:open:${session.categoryId}:${session.supportRoleId}`)
      .setPlaceholder(session.placeholder)
      .addOptions(session.options)
  );

  await targetChannel.send({
    embeds: [EmbedBuilder.from(session.embedData)],
    components: [liveMenu],
  });

  sessions.delete(sessionId);

  await interaction.update({
    content: `Dropdown ticket panel posted successfully in <#${targetChannel.id}>.`,
    embeds: [],
    components: [],
  });
}

async function handleOpenTicket(interaction, categoryId, supportRoleId, reason) {
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
      .slice(0, 60) || 'user';

  const safeReason =
    reason
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'support';

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
    name: `${TICKET_NAME_PREFIX}-${safeReason}-${safeName}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: categoryId && categoryId !== '0' ? categoryId : null,
    topic:
      `Ticket owner: ${interaction.user.id} | ` +
      `Reason: ${reason} | ` +
      `Created from dropdown message ${interaction.message.id}`,
    permissionOverwrites,
  });

  const closeControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticketpanel:claim')
      .setLabel('Claim Ticket')
      .setStyle(ButtonStyle.Primary),
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
      `Selected reason: **${reason}**\n` +
      'Describe what you need and a staff member will help you shortly.',
    components: [closeControls],
  });

  await interaction.reply({
    content: `Your ticket has been created: ${ticketChannel}`,
    ephemeral: true,
  });
}
