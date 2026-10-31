/**
 * Các route này đều dùng cho các API có prefix /api/admin/accommodations/* : là các API dành cho customer (user) đã login vào web
 */

const express = require("express");
const router = express.Router();

const accommodationController = require("../../controllers/admin/accommodation/accommodationController");

const requireAdminLogin = require("../../middlewares/requireAdminLogin");
const requireRole = require("../../middlewares/requireRole");

router.get("/", requireAdminLogin, accommodationController.getAccommodationsList);
router.get("/stats", requireAdminLogin, accommodationController.getAccommodationStats);
router.post("/", requireAdminLogin, accommodationController.createAccommodation);
router.put("/:id", requireAdminLogin, accommodationController.updateAccommodation);
router.patch(
  "/:id/status",
  requireAdminLogin,
  accommodationController.updateAccommodationStatus,
);
router.patch(
  "/:id/featured",
  requireAdminLogin,
  accommodationController.updateAccommodationFeatured,
);
router.delete(
  "/:id",
  requireAdminLogin,
  requireRole("ADMIN"),
  accommodationController.deleteAccommodation,
);
router.get("/:id", requireAdminLogin, accommodationController.getAccommodationDetail);

// export
module.exports = router;
