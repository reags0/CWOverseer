const fs = require('fs');
const path = require('path');

const inviteTrackerPath = path.join(__dirname, '..', 'data', 'invite-tracker.json');

async function initializeInviteTracking(client) {
  ensureInviteTrackingState(client);

  for (const guild of client.guilds.cache.values()) {
    await refreshGuildInvites(guild, client);
  }
}

function ensureInviteTrackingState(client) {
  if (!client.inviteCache) {
    client.inviteCache = new Map();
  }

  if (!client.inviteCounts) {
    client.inviteCounts = new Map();
  }

  if (!client.inviteTrackerData) {
    client.inviteTrackerData = loadInviteTrackerData();
  }

  if (!client.inviteAttributions) {
    client.inviteAttributions = new Map();
  }

  hydrateInviteTrackingMaps(client);
}

function hydrateInviteTrackingMaps(client) {
  for (const [guildId, guildData] of Object.entries(client.inviteTrackerData.guilds)) {
    client.inviteCounts.set(
      guildId,
      new Map(
        Object.entries(guildData.inviterCounts || {}).map(([userId, inviteCount]) => [
          userId,
          Number(inviteCount) || 0,
        ])
      )
    );
    client.inviteAttributions.set(guildId, new Map(Object.entries(guildData.memberInviters || {})));
  }
}

async function refreshGuildInvites(guild, client) {
  ensureInviteTrackingState(client);

  try {
    const invites = await guild.invites.fetch();
    const guildInviteCache = new Map();

    for (const invite of invites.values()) {
      guildInviteCache.set(invite.code, serializeInvite(invite));
    }

    client.inviteCache.set(guild.id, guildInviteCache);

    const guildData = getGuildData(client, guild.id);
    guildData.inviteSnapshots = Object.fromEntries(
      Array.from(guildInviteCache.entries()).map(([code, snapshot]) => [code, snapshot])
    );
    saveInviteTrackerData(client.inviteTrackerData);
  } catch (error) {
    console.error(`Failed to refresh invites for guild ${guild.id}:`, error);
  }
}

async function handleInviteCreate(invite, client) {
  ensureInviteTrackingState(client);

  const guildInviteCache = client.inviteCache.get(invite.guild.id) || new Map();
  guildInviteCache.set(invite.code, serializeInvite(invite));
  client.inviteCache.set(invite.guild.id, guildInviteCache);

  const guildData = getGuildData(client, invite.guild.id);
  guildData.inviteSnapshots[invite.code] = serializeInvite(invite);

  if (invite.inviterId || invite.inviter?.id) {
    const inviterId = invite.inviterId || invite.inviter.id;
    const guildInviteCounts = client.inviteCounts.get(invite.guild.id) || new Map();

    if (!guildInviteCounts.has(inviterId)) {
      guildInviteCounts.set(inviterId, 0);
      client.inviteCounts.set(invite.guild.id, guildInviteCounts);
    }

    if (!guildData.inviterCounts[inviterId]) {
      guildData.inviterCounts[inviterId] = 0;
    }
  }

  saveInviteTrackerData(client.inviteTrackerData);
}

function handleInviteDelete(invite, client) {
  ensureInviteTrackingState(client);

  const guildInviteCache = client.inviteCache.get(invite.guild.id);

  if (guildInviteCache) {
    guildInviteCache.delete(invite.code);
  }

  const guildData = getGuildData(client, invite.guild.id);
  delete guildData.inviteSnapshots[invite.code];
  saveInviteTrackerData(client.inviteTrackerData);
}

async function handleGuildMemberAdd(member, client) {
  ensureInviteTrackingState(client);

  try {
    const guildData = getGuildData(client, member.guild.id);
    const existingAttribution = guildData.memberInviters[member.user.id] || null;
    const isRejoin = Boolean(guildData.joinedUsers[member.user.id]);

    guildData.joinedUsers[member.user.id] = true;

    const previousInvites = cloneInviteCache(client.inviteCache.get(member.guild.id));
    const currentInvites = await fetchGuildInvites(member.guild);
    const usedInvite = detectUsedInvite(previousInvites, currentInvites);

    applyInviteSnapshot(client, member.guild.id, currentInvites);

    let inviterId = existingAttribution;

    if (usedInvite?.inviterId) {
      inviterId = usedInvite.inviterId;
      guildData.memberInviters[member.user.id] = inviterId;
    }

    if (!isRejoin && inviterId) {
      incrementInviteCount(client, member.guild.id, inviterId);
    }

    saveInviteTrackerData(client.inviteTrackerData);

    return {
      inviteCount: inviterId ? getInviteCount(client, member.guild.id, inviterId) : 0,
      inviterId,
      isRejoin,
      usedInviteCode: usedInvite?.code || null,
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
  ensureInviteTrackingState(client);
  const guildInviteCounts = client.inviteCounts.get(guildId);
  return guildInviteCounts?.get(userId) || 0;
}

function getInviteLeaderboard(client, guildId) {
  ensureInviteTrackingState(client);
  const guildInviteCounts = client.inviteCounts.get(guildId) || new Map();

  return Array.from(guildInviteCounts.entries())
    .map(([userId, inviteCount]) => ({ userId, inviteCount }))
    .sort((left, right) => right.inviteCount - left.inviteCount);
}

function loadInviteTrackerData() {
  try {
    if (!fs.existsSync(inviteTrackerPath)) {
      return { guilds: {} };
    }

    const raw = fs.readFileSync(inviteTrackerPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { guilds: {} };
    }

    if (!parsed.guilds || typeof parsed.guilds !== 'object' || Array.isArray(parsed.guilds)) {
      return { guilds: {} };
    }

    for (const guildData of Object.values(parsed.guilds)) {
      normalizeGuildData(guildData);
    }

    return parsed;
  } catch (error) {
    console.error('Failed to load invite tracker data:', error);
    return { guilds: {} };
  }
}

function saveInviteTrackerData(inviteTrackerData) {
  try {
    fs.mkdirSync(path.dirname(inviteTrackerPath), { recursive: true });
    fs.writeFileSync(inviteTrackerPath, `${JSON.stringify(inviteTrackerData, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to save invite tracker data:', error);
  }
}

function getGuildData(client, guildId) {
  const guilds = client.inviteTrackerData.guilds;

  if (!guilds[guildId]) {
    guilds[guildId] = createEmptyGuildData();
  }

  normalizeGuildData(guilds[guildId]);
  return guilds[guildId];
}

function createEmptyGuildData() {
  return {
    inviteSnapshots: {},
    inviterCounts: {},
    joinedUsers: {},
    memberInviters: {},
  };
}

function normalizeGuildData(guildData) {
  if (!guildData.inviteSnapshots || typeof guildData.inviteSnapshots !== 'object' || Array.isArray(guildData.inviteSnapshots)) {
    guildData.inviteSnapshots = {};
  }

  if (!guildData.inviterCounts || typeof guildData.inviterCounts !== 'object' || Array.isArray(guildData.inviterCounts)) {
    guildData.inviterCounts = {};
  }

  for (const [userId, inviteCount] of Object.entries(guildData.inviterCounts)) {
    guildData.inviterCounts[userId] = Number(inviteCount) || 0;
  }

  if (!guildData.joinedUsers || typeof guildData.joinedUsers !== 'object' || Array.isArray(guildData.joinedUsers)) {
    guildData.joinedUsers = {};
  }

  if (!guildData.memberInviters || typeof guildData.memberInviters !== 'object' || Array.isArray(guildData.memberInviters)) {
    guildData.memberInviters = {};
  }
}

function serializeInvite(invite) {
  return {
    code: invite.code,
    inviterId: invite.inviterId || invite.inviter?.id || null,
    maxUses: invite.maxUses || 0,
    temporary: Boolean(invite.temporary),
    uses: invite.uses || 0,
  };
}

async function fetchGuildInvites(guild) {
  const invites = await guild.invites.fetch();
  const snapshots = new Map();

  for (const invite of invites.values()) {
    snapshots.set(invite.code, serializeInvite(invite));
  }

  return snapshots;
}

function cloneInviteCache(inviteCache) {
  return new Map(inviteCache ? Array.from(inviteCache.entries()) : []);
}

function applyInviteSnapshot(client, guildId, currentInvites) {
  client.inviteCache.set(guildId, currentInvites);

  const guildData = getGuildData(client, guildId);
  guildData.inviteSnapshots = Object.fromEntries(currentInvites.entries());
}

function detectUsedInvite(previousInvites, currentInvites) {
  for (const [code, currentInvite] of currentInvites.entries()) {
    const previousInvite = previousInvites.get(code);
    const previousUses = previousInvite?.uses || 0;

    if ((currentInvite.uses || 0) > previousUses) {
      return {
        ...currentInvite,
        code,
      };
    }
  }

  const deletedCandidates = [];

  for (const [code, previousInvite] of previousInvites.entries()) {
    if (currentInvites.has(code)) {
      continue;
    }

    if (previousInvite.maxUses === 1) {
      deletedCandidates.push({
        ...previousInvite,
        code,
      });
    }
  }

  if (deletedCandidates.length === 1) {
    return deletedCandidates[0];
  }

  return null;
}

function incrementInviteCount(client, guildId, inviterId) {
  const guildInviteCounts = client.inviteCounts.get(guildId) || new Map();
  const nextCount = (guildInviteCounts.get(inviterId) || 0) + 1;
  guildInviteCounts.set(inviterId, nextCount);
  client.inviteCounts.set(guildId, guildInviteCounts);

  const guildData = getGuildData(client, guildId);
  guildData.inviterCounts[inviterId] = nextCount;
}

module.exports = {
  getInviteCount,
  getInviteLeaderboard,
  handleGuildMemberAdd,
  handleInviteCreate,
  handleInviteDelete,
  initializeInviteTracking,
  refreshGuildInvites,
};
