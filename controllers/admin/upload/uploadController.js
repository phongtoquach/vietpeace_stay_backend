const fs = require("fs");
const path = require("path");

function uploadAccommodationImage(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "Vui lòng chọn ảnh." });
  }

  const relativeUrl = `/uploads/accommodations/${req.file.filename}`;
  return res.status(201).json({ data: { url: relativeUrl } });
}

module.exports = { uploadAccommodationImage };
