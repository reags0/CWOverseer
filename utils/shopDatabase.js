const fs = require('fs');
const path = require('path');

const dataDirectory = path.join(__dirname, '..', 'data');
const databasePath = path.join(dataDirectory, 'shop.json');

function ensureDatabase() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }

  if (!fs.existsSync(databasePath)) {
    writeDatabase({
      items: [],
      baskets: {},
    });
  }
}

function readDatabase() {
  ensureDatabase();
  const rawData = fs.readFileSync(databasePath, 'utf8');
  return JSON.parse(rawData);
}

function writeDatabase(data) {
  ensureDatabase();
  fs.writeFileSync(databasePath, JSON.stringify(data, null, 2));
}

function getReservationCounts(data) {
  const counts = {};

  for (const basketItemIds of Object.values(data.baskets)) {
    for (const itemId of basketItemIds) {
      counts[itemId] = (counts[itemId] || 0) + 1;
    }
  }

  return counts;
}

function normalizeProductName(value) {
  return value.trim().toLowerCase();
}

function createItemId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

//
// ✅ UPDATED: add price support
//
function addCode(productName, code, addedBy, oneTime = false, imageUrl = null, price = 0) {
  const data = readDatabase();

  const item = {
    id: createItemId(),
    productName,
    productKey: normalizeProductName(productName),
    code,
    imageUrl,
    price, // ✅ NEW
    oneTime,
    status: 'available',
    addedBy,
    addedAt: new Date().toISOString(),
    reservedBy: null,
    reservedAt: null,
    purchasedBy: null,
    purchasedAt: null,
  };

  data.items.push(item);
  writeDatabase(data);
  return item;
}

function getStockSummary() {
  const data = readDatabase();
  const summary = new Map();
  const reservationCounts = getReservationCounts(data);

  for (const item of data.items) {
    const entry =
      summary.get(item.productKey) ||
      {
        productName: item.productName,
        available: 0,
        reserved: 0,
        oneTime: 0,
        reusable: 0,
      };

    if (item.status === 'available') {
      entry.available += 1;
    }

    const reservedCount = item.oneTime
      ? item.status === 'reserved'
        ? 1
        : 0
      : reservationCounts[item.id] || 0;

    if (reservedCount > 0) {
      entry.reserved += 1;
    }

    if (item.oneTime) {
      entry.oneTime += 1;
    } else {
      entry.reusable += 1;
    }

    summary.set(item.productKey, entry);
  }

  return [...summary.values()].sort((a, b) =>
    a.productName.localeCompare(b.productName)
  );
}

function getProductSummary(productName) {
  const data = readDatabase();
  const productKey = normalizeProductName(productName);
  const items = data.items.filter((item) => item.productKey === productKey);
  const reservationCounts = getReservationCounts(data);

  return {
    productName,
    total: items.length,
    available: items.filter((item) => item.status === 'available').length,
    reserved: items.filter((item) =>
      item.oneTime ? item.status === 'reserved' : (reservationCounts[item.id] || 0) > 0
    ).length,
    oneTime: items.filter((item) => item.oneTime).length,
    reusable: items.filter((item) => !item.oneTime).length,
  };
}

function getCodes(productName) {
  const data = readDatabase();
  const reservationCounts = getReservationCounts(data);

  const items = productName
    ? data.items.filter(
        (item) => item.productKey === normalizeProductName(productName)
      )
    : data.items;

  return items
    .map((item) => ({
      ...item,
      basketReservations: item.oneTime
        ? item.status === 'reserved'
          ? 1
          : 0
        : reservationCounts[item.id] || 0,
    }))
    .sort((a, b) => {
      if (a.productName === b.productName) {
        return a.addedAt.localeCompare(b.addedAt);
      }
      return a.productName.localeCompare(b.productName);
    });
}

function deleteCode(itemId) {
  const data = readDatabase();
  const itemIndex = data.items.findIndex((item) => item.id === itemId);

  if (itemIndex === -1) {
    return null;
  }

  const [removedItem] = data.items.splice(itemIndex, 1);

  for (const userId of Object.keys(data.baskets)) {
    data.baskets[userId] = data.baskets[userId].filter((id) => id !== itemId);

    if (data.baskets[userId].length === 0) {
      delete data.baskets[userId];
    }
  }

  writeDatabase(data);
  return removedItem;
}

function addToBasket(userId, code) {
  const data = readDatabase();
  const trimmedCode = code.trim();
  const item = data.items.find((entry) => entry.code === trimmedCode);

  if (!item) return null;

  if (item.oneTime && item.status !== 'available') return false;

  if (!data.baskets[userId]) {
    data.baskets[userId] = [];
  }

  if (data.baskets[userId].includes(item.id)) return 'duplicate';

  if (item.oneTime) {
    item.status = 'reserved';
    item.reservedBy = userId;
    item.reservedAt = new Date().toISOString();
  }

  data.baskets[userId].push(item.id);
  writeDatabase(data);

  return item; // ✅ includes price automatically now
}

function getBasket(userId) {
  const data = readDatabase();
  const basketItemIds = data.baskets[userId] || [];

  return basketItemIds
    .map((itemId) => data.items.find((item) => item.id === itemId))
    .filter(Boolean);
}

//
// ✅ NEW: total calculator
//
function getBasketTotal(userId) {
  const basket = getBasket(userId);
  return basket.reduce((total, item) => total + (item.price || 0), 0);
}

function removeFromBasket(userId, itemId) {
  const data = readDatabase();
  const basketItemIds = data.baskets[userId] || [];

  const directMatch = data.items.find((entry) => entry.id === itemId);
  const codeMatch = data.items.find(
    (entry) => basketItemIds.includes(entry.id) && entry.code === itemId.trim()
  );

  const targetItem = directMatch || codeMatch;

  if (!targetItem || !basketItemIds.includes(targetItem.id)) return null;

  data.baskets[userId] = basketItemIds.filter((id) => id !== targetItem.id);

  if (targetItem.oneTime) {
    targetItem.status = 'available';
    targetItem.reservedBy = null;
    targetItem.reservedAt = null;
  }

  writeDatabase(data);
  return targetItem;
}

function clearBasket(userId) {
  const basketItems = getBasket(userId);

  for (const item of basketItems) {
    removeFromBasket(userId, item.id);
  }

  return basketItems.length;
}

function completePurchase(userId) {
  const data = readDatabase();
  const basketItemIds = data.baskets[userId] || [];

  if (basketItemIds.length === 0) return [];

  const purchasedItems = [];

  for (const itemId of basketItemIds) {
    const item = data.items.find((entry) => entry.id === itemId);
    if (!item) continue;

    if (item.oneTime) {
      item.status = 'purchased';
      item.purchasedBy = userId;
      item.purchasedAt = new Date().toISOString();
    }

    purchasedItems.push(item);
  }

  delete data.baskets[userId];
  writeDatabase(data);

  return purchasedItems;
}

module.exports = {
  addCode,
  addToBasket,
  clearBasket,
  completePurchase,
  deleteCode,
  getBasket,
  getBasketTotal, // ✅ export this
  getCodes,
  getProductSummary,
  getStockSummary,
  removeFromBasket,
};
