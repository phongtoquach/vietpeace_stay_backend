/**
 * Các route này đều dùng cho các API có prefix /api/web/accommodations/* : là các API dành cho customer (user) đã login vào web
 */

const express = require("express");

const router = express.Router();

const accommodationController = require("../../controllers/web/accommodation/accommodationController");


router.post("/search", accommodationController.searchAccommodations);

router.get("/detail/:id/:slug", accommodationController.getAccommodationDetail);


// export
module.exports = router;