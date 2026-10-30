const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { uploadAccommodationImage } = require("../../controllers/admin/upload/uploadController");

const router = express.Router();
const uploadDir = path.join(__dirname, "../../public/uploads/accommodations");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)),
});

router.post("/accommodations", upload.single("file"), uploadAccommodationImage);
module.exports = router;
