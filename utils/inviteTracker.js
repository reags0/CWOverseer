async function initializeInviteTracking(client) {
  if (!client.inviteCache) {
    client.inviteCache = new Map();
  }

  if (!client.inviteCounts) {
    client.inviteCounts = new Map();
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

    if (!usedInvite || !(usedInvite.inviterId || usedInvite.inviter?.id)) {
      return;
    }

    const inviterId = usedInvite.inviterId || usedInvite.inviter.id;
    const guildInviteCounts = client.inviteCounts.get(member.guild.id) || new Map();

    guildInviteCounts.set(inviterId, (guildInviteCounts.get(inviterId) || 0) + 1);
    client.inviteCounts.set(member.guild.id, guildInviteCounts);
  } catch (error) {
    console.error(`Failed to track invite for member ${member.user.id}:`, error);
  }
}

function getInviteCount(client, guildId, userId) {
  const guildInviteCounts = client.inviteCounts?.get(guildId);

  if (!guildInviteCounts) {
    return 0;
  }

  return guildInviteCounts.get(userId) || 0;
}

module.exports = {
  getInviteCount,
  handleGuildMemberAdd,
  handleInviteCreate,
  handleInviteDelete,
  initializeInviteTracking,
  refreshGuildInvites,
};
