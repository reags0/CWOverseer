const fs = require('fs');
const path = require('path');

const commandsPath = path.join(__dirname, '..', 'commands');

function getCommandFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...getCommandFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

function getCommands() {
  const commandFiles = getCommandFiles(commandsPath);
  const commands = [];
  const seenCommandNames = new Map();

  for (const filePath of commandFiles) {
    const command = require(filePath);

    if (!command.data || !command.execute) {
      console.warn(`Skipping invalid command file: ${filePath}`);
      continue;
    }

    const commandName = command.data.name;
    const existingPath = seenCommandNames.get(commandName);

    if (existingPath) {
      throw new Error(
        `Duplicate slash command name "${commandName}" found in ${existingPath} and ${filePath}. ` +
          'Command names must be unique before the bot can start or deploy commands.'
      );
    }

    seenCommandNames.set(commandName, filePath);
    commands.push(command);
  }

  return commands;
}

function loadCommands(client) {
  const commands = getCommands();

  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
}

module.exports = { getCommands, loadCommands };
