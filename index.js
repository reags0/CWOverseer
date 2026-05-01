const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { ensureShopSchema } = require('./utils/initDatabase');

loadEnv();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();
client.embedBuilderSessions = new Collection();

loadCommands(client);

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});


// ✅ ADD THIS BLOCK
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '+line') {
    try {
      await message.delete().catch(() => {});

      await message.channel.send(
        'https://cdn.imageurlgenerator.com/uploads/90198aaa-3769-4d6d-96e6-5cbe9f0bab9a.gif'
      );
    } catch (err) {
      console.error('Error in +line command:', err);
    }
  }
});
// ✅ END BLOCK


client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        await interaction.reply({
          content: 'That command was not found.',
          ephemeral: true,
        });
        return;
      }

      await command.execute(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const commandName = interaction.customId.split(':')[0];
      const command = client.commands.get(commandName);

      if (command?.handleModalSubmit) {
        await command.handleModalSubmit(interaction);
      }

      return;
    }

    if (interaction.isButton()) {
      const commandName = interaction.customId.split(':')[0];
      const command = client.commands.get(commandName);

      if (command?.handleButton) {
        await command.handleButton(interaction);
      }
    }
  } catch (error) {
    const interactionName =
      interaction.commandName || interaction.customId || interaction.type;

    console.error(`Error running interaction ${interactionName}:`, error);

    const reply = {
      content: 'Something went wrong while running that command.',
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
      return;
    }

    await interaction.reply(reply);
  }
});

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

startBot();

async function startBot() {
  try {
    await ensureShopSchema();
    console.log('Database schema is ready.');
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
    console.error(
      'The bot will still try to come online, but database-backed commands may fail until DATABASE_URL is fixed.'
    );
  }

  await client.login(token);
}

function loadEnv() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
