/**
 * Các route này đều dùng cho các API có prefix /api/web/booking/* : là các API liên quan đến tính toán các giá tiền của booking
 */

const express = require("express");

const router = express.Router();

const bookingController = require("../../controllers/web/booking/bookingController");


router.post("/booking-preview", bookingController.getBookingPreview);


// export
module.exports = router;