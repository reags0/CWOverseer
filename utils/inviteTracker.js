const fs = require('fs');
const path = require('path');

const joinedUsersPath = path.join(__dirname, '..', 'data', 'joined-users.json');

async function initializeInviteTracking(client) {
  if (!client.inviteCache) {
    client.inviteCache = new Map();
  }

  if (!client.inviteCounts) {
    client.inviteCounts = new Map();
  }

  if (!client.joinedUsers) {
    client.joinedUsers = loadJoinedUsers();
  }

  for (const guild of client.guilds.cache.values()) {
    await refreshGuildInvites(guild, client);
  }
}

async function refreshGuildInvites(guild, client) {
  try {
    const invites = await guild.invites.fetch();
    const guildInviteCache = new Map();
    const guildInviteCounts = new Map();

    for (const invite of invites.values()) {
      guildInviteCache.set(invite.code, {
        inviterId: invite.inviterId || invite.inviter?.id || null,
        uses: invite.uses || 0,
      });

      if (invite.inviterId || invite.inviter?.id) {
        const inviterId = invite.inviterId || invite.inviter.id;
        guildInviteCounts.set(
          inviterId,
          (guildInviteCounts.get(inviterId) || 0) + (invite.uses || 0)
        );
      }
    }

    client.inviteCache.set(guild.id, guildInviteCache);
    client.inviteCounts.set(guild.id, guildInviteCounts);
  } catch (error) {
    console.error(`Failed to refresh invites for guild ${guild.id}:`, error);
  }
}

async function handleInviteCreate(invite, client) {
  const guildInviteCache = client.inviteCache.get(invite.guild.id) || new Map();

  guildInviteCache.set(invite.code, {
    inviterId: invite.inviterId || invite.inviter?.id || null,
    uses: invite.uses || 0,
  });

  client.inviteCache.set(invite.guild.id, guildInviteCache);

  if (invite.inviterId || invite.inviter?.id) {
    const guildInviteCounts = client.inviteCounts.get(invite.guild.id) || new Map();
    const inviterId = invite.inviterId || invite.inviter.id;

    if (!guildInviteCounts.has(inviterId)) {
      guildInviteCounts.set(inviterId, 0);
    }

    client.inviteCounts.set(invite.guild.id, guildInviteCounts);
  }
}

function handleInviteDelete(invite, client) {
  const guildInviteCache = client.inviteCache.get(invite.guild.id);

  if (!guildInviteCache) {
    return;
  }

  guildInviteCache.delete(invite.code);
}

async function handleGuildMemberAdd(member, client) {
  try {
    const isRejoin = hasJoinedBefore(client, member.guild.id, member.user.id);
    markJoined(client, member.guild.id, member.user.id);

    const previousInvites = client.inviteCache.get(member.guild.id) || new Map();
    const currentInvites = await member.guild.invites.fetch();
    let usedInvite = null;

    for (const invite of currentInvites.values()) {
      const previousInvite = previousInvites.get(invite.code);
      const previousUses = previousInvite ? previousInvite.uses : 0;
      const currentUses = invite.uses || 0;

      if (currentUses > previousUses) {
        usedInvite = invite;
        break;
      }
    }

    await refreshGuildInvites(member.guild, client);

    if (isRejoin) {
      return {
        inviteCount: 0,
        inviterId: null,
        isRejoin: true,
        usedInviteCode: usedInvite?.code || null,
      };
    }

    if (!usedInvite || !(usedInvite.inviterId || usedInvite.inviter?.id)) {
      return {
        inviteCount: 0,
        inviterId: null,
        isRejoin: false,
        usedInviteCode: null,
      };
    }

    const inviterId = usedInvite.inviterId || usedInvite.inviter.id;
    const inviteCount = getInviteCount(client, member.guild.id, inviterId);

    return {
      inviteCount,
      inviterId,
      isRejoin: false,
      usedInviteCode: usedInvite.code,
    };
  } catch (error) {
    console.error(`Failed to track invite for member ${member.user.id}:`, error);
    return {
      inviteCount: 0,
      inviterId: null,
      isRejoin: false,
      usedInviteCode: null,
    };
  }
}

function getInviteCount(client, guildId, userId) {
  const guildInviteCounts = client.inviteCounts?.get(guildId);

  if (!guildInviteCounts) {
    return 0;
  }

  return guildInviteCounts.get(userId) || 0;
}

function loadJoinedUsers() {
  try {
    if (!fs.existsSync(joinedUsersPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(joinedUsersPath, 'utf8'));
  } catch (error) {
    console.error('Failed to load joined users data:', error);
    return {};
  }
}

function saveJoinedUsers(joinedUsers) {
  try {
    fs.mkdirSync(path.dirname(joinedUsersPath), { recursive: true });
    fs.writeFileSync(joinedUsersPath, JSON.stringify(joinedUsers, null, 2));
  } catch (error) {
    console.error('Failed to save joined users data:', error);
  }
}

function hasJoinedBefore(client, guildId, userId) {
  return Boolean(client.joinedUsers?.[guildId]?.[userId]);
}

function markJoined(client, guildId, userId) {
  if (!client.joinedUsers) {
    client.joinedUsers = {};
  }

  if (!client.joinedUsers[guildId]) {
    client.joinedUsers[guildId] = {};
  }

  client.joinedUsers[guildId][userId] = true;
  saveJoinedUsers(client.joinedUsers);
}

module.exports = {
  getInviteCount,
  handleGuildMemberAdd,
  handleInviteCreate,
  handleInviteDelete,
  initializeInviteTracking,
  refreshGuildInvites,
};
