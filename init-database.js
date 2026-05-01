const { ensureShopSchema } = require('./utils/initDatabase');

ensureShopSchema()
  .then(() => {
    console.log('Database schema initialized successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Database schema initialization failed:', error);
    process.exit(1);
  });
