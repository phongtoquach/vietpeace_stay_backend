require("dotenv").config();

const assert = require("node:assert/strict");
const sql = require("mssql");
const accommodationService = require("../services/accommodation_service");
const { connectDB, getDBPool } = require("../configs/database");

const TEST_ID = 1;

async function run() {
  assert.equal(
    typeof accommodationService.updateAccommodation,
    "function",
    "updateAccommodation phải được export từ accommodation_service",
  );

  assert.equal(
    typeof require("../controllers/admin/accommodation/accommodationController").updateAccommodation,
    "function",
    "controller phải export updateAccommodation",
  );

  const routes = require("../routes/admin/accommodation_admin_routes");
  assert.equal(typeof routes, "function", "route accommodation phải load được");

  await connectDB();
  const pool = getDBPool();
  const beforeResult = await pool
    .request()
    .input("id", sql.Int, TEST_ID)
    .query(`
      SELECT id, accommodation_name, accommodation_code, location_id,
             province_id, ward_id, status, is_featured, sort_order
      FROM dbo.accommodations
      WHERE id = @id AND deleted_at IS NULL;
    `);

  const before = beforeResult.recordset[0];
  assert.ok(before, `Không tìm thấy accommodation id=${TEST_ID}`);

  const originalName = before.accommodation_name;
  const temporaryName = `${originalName} [PUT TEST]`;
  let changed = false;

  try {
    // Chỉ gửi name. Các field còn lại phải được service giữ nguyên.
    await accommodationService.updateAccommodation(
      TEST_ID,
      { name: temporaryName },
      { role: "ADMIN" },
    );
    changed = true;

    const afterResult = await pool
      .request()
      .input("id", sql.Int, TEST_ID)
      .query(`
        SELECT accommodation_name, accommodation_code, location_id,
               province_id, ward_id, status, is_featured, sort_order
        FROM dbo.accommodations
        WHERE id = @id;
      `);

    const after = afterResult.recordset[0];
    assert.equal(after.accommodation_name, temporaryName);
    assert.equal(after.accommodation_code, before.accommodation_code);
    assert.equal(after.location_id, before.location_id);
    assert.equal(after.province_id, before.province_id);
    assert.equal(after.ward_id, before.ward_id);
    assert.equal(after.status, before.status);
    assert.equal(after.is_featured, before.is_featured);
    assert.equal(after.sort_order, before.sort_order);

    console.log("PUT chỉ gửi name: PASS");
  } finally {
    // Test phải trả dữ liệu về trạng thái ban đầu.
    if (changed) {
      await accommodationService.updateAccommodation(
        TEST_ID,
        { name: originalName },
        { role: "ADMIN" },
      );
      console.log("Đã khôi phục tên accommodation sau test.");
    }
    await pool.close();
  }
}

run().catch((error) => {
  console.error("PUT chỉ gửi name: FAIL", error.message);
  process.exitCode = 1;
});
