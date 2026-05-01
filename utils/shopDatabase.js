const pool = require('./database');

function normalizeProductName(value) {
  return value.trim().toLowerCase();
}

function createItemId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

//
// ✅ ADD CODE
//
async function addCode(productName, code, addedBy, oneTime = false, imageUrl = null, price = 0, robuxPrice = null) {
  const id = createItemId();

  await pool.query(
    `INSERT INTO items 
    (id, product_name, product_key, code, image_url, price, robux_price, one_time, status, added_by, added_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'available',$9,NOW())`,
    [
      id,
      productName,
      normalizeProductName(productName),
      code,
      imageUrl,
      price,
      robuxPrice,
      oneTime,
      addedBy,
    ]
  );

  return {
    id,
    productName,
    code,
    imageUrl,
    price,
    robuxPrice,
    oneTime,
  };
}

//
// ✅ ADD TO BASKET
//
async function addToBasket(userId, code) {
  const { rows } = await pool.query(
    `SELECT * FROM items WHERE code = $1`,
    [code.trim()]
  );

  const item = rows[0];
  if (!item) return null;

  if (item.one_time && item.status !== 'available') return false;

  const existing = await pool.query(
    `SELECT * FROM baskets WHERE user_id=$1 AND item_id=$2`,
    [userId, item.id]
  );

  if (existing.rows.length > 0) return 'duplicate';

  if (item.one_time) {
    await pool.query(
      `UPDATE items SET status='reserved', reserved_by=$1, reserved_at=NOW() WHERE id=$2`,
      [userId, item.id]
    );
  }

  await pool.query(
    `INSERT INTO baskets (user_id, item_id) VALUES ($1,$2)`,
    [userId, item.id]
  );

  return item;
}

//
// ✅ GET BASKET
//
async function getBasket(userId) {
  const { rows } = await pool.query(
    `SELECT i.* FROM baskets b
     JOIN items i ON b.item_id = i.id
     WHERE b.user_id = $1`,
    [userId]
  );

  return rows;
}

//
// ✅ TOTALS
//
async function getBasketTotal(userId) {
  const { rows } = await pool.query(
    `SELECT 
      COALESCE(SUM(price),0) as total_gbp,
      COALESCE(SUM(robux_price),0) as total_robux
     FROM baskets b
     JOIN items i ON b.item_id = i.id
     WHERE b.user_id = $1`,
    [userId]
  );

  return {
    gbp: Number(rows[0].total_gbp),
    robux: Number(rows[0].total_robux),
  };
}

//
// ✅ REMOVE FROM BASKET
//
async function removeFromBasket(userId, code) {
  const { rows } = await pool.query(
    `SELECT i.* FROM items i
     JOIN baskets b ON b.item_id = i.id
     WHERE b.user_id = $1 AND i.code = $2`,
    [userId, code.trim()]
  );

  const item = rows[0];
  if (!item) return null;

  await pool.query(
    `DELETE FROM baskets WHERE user_id=$1 AND item_id=$2`,
    [userId, item.id]
  );

  if (item.one_time) {
    await pool.query(
      `UPDATE items SET status='available', reserved_by=NULL, reserved_at=NULL WHERE id=$1`,
      [item.id]
    );
  }

  return item;
}

//
// ✅ CLEAR BASKET
//
async function clearBasket(userId) {
  const items = await getBasket(userId);

  for (const item of items) {
    await removeFromBasket(userId, item.code);
  }

  return items.length;
}

//
// ✅ COMPLETE PURCHASE
//
async function completePurchase(userId) {
  const items = await getBasket(userId);

  for (const item of items) {
    if (item.one_time) {
      await pool.query(
        `UPDATE items 
         SET status='purchased', purchased_by=$1, purchased_at=NOW()
         WHERE id=$2`,
        [userId, item.id]
      );
    }
  }

  await pool.query(`DELETE FROM baskets WHERE user_id=$1`, [userId]);

  return items;
}

module.exports = {
  addCode,
  addToBasket,
  getBasket,
  getBasketTotal,
  removeFromBasket,
  clearBasket,
  completePurchase,
};
