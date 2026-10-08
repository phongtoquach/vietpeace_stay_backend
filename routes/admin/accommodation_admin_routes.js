/**
 * Các route này đều dùng cho các API có prefix /api/admin/accommodations/* : là các API dành cho customer (user) đã login vào web
 */

const express = require("express");
const router = express.Router();

const accommodationController = require("../../controllers/admin/accommodation/accommodationController");


router.get("/", accommodationController.getAccommodationsList);

router.get("/:id", accommodationController.getAccommodationDetail);


// export
module.exports = router;