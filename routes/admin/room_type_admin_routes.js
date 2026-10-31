const express = require("express");
const router = express.Router();

const roomTypeController = require("../../controllers/admin/room_type/roomTypeController");

router.get("/", roomTypeController.getRoomTypesList);
router.post("/", roomTypeController.createRoomType);
router.get("/:id", roomTypeController.getRoomTypeDetail);
router.put("/:id", roomTypeController.updateRoomType);
router.delete("/:id", roomTypeController.deleteRoomType);

module.exports = router;
