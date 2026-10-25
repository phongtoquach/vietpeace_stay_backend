/**
 * Các route này đều dùng cho các API có prefix /api/admin/accommodations/* : là các API dành cho customer (user) đã login vào web
 */

const express = require("express");
const router = express.Router();

const accommodationController = require("../../controllers/admin/accommodation/accommodationController");

const requireAdminLogin = require("../../middlewares/requireAdminLogin");


router.get("/", requireAdminLogin, accommodationController.getAccommodationsList);

router.get("/:id", requireAdminLogin, accommodationController.getAccommodationDetail);


// export
module.exports = router;