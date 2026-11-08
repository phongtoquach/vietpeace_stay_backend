require('dotenv').config({
  quiet: true
});
const fs = require('node:fs');
const path = require('node:path');
const {
  connectDB
} = require('../configs/database');
(async () => {
  let pool;
  try {
    pool = await connectDB();
    for (const file of ['20261107_pricing_inventory.sql', '20261107_remove_inventory_blocks.sql', '20261107_remove_price_limits.sql', '20261107_remove_period_global_toggle.sql', '20261107_lock_applied_periods.sql']) {
      const source = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8');
      for (const batch of source.split(/^GO\s*$/mi).filter(x => x.trim())) await pool.request().batch(batch);
    }
    await pool.request().batch(fs.readFileSync(path.join(__dirname, '../migrations/20261108_pricing_proposals.sql'), 'utf8'));
    await pool.request().batch(fs.readFileSync(path.join(__dirname, '../migrations/20261108_period_direction.sql'), 'utf8'));
    await pool.request().batch(fs.readFileSync(path.join(__dirname, '../migrations/20261108_cleanup_sale_controls.sql'), 'utf8'));
    console.log('Pricing/inventory migration completed. Existing rates and bookings preserved.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.close();
  }
})();
