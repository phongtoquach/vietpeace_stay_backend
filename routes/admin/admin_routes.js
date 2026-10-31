/**
 * Các route này đều dùng cho các API có prefix /api/admin/* : là các API sử dụng cho phần Admin Panel
 */

const express = require("express");
const router = express.Router();

const requireAdminLogin = require("../../middlewares/requireAdminLogin");

/**
 * ADMIN AUTH
 * /api/admin/auth/*
 * Gồm các API như :
 * - /api/admin/auth/login : thực hiện authen & login vào Admin Panel cho Admin user
 * - /api/admin/auth/logout : thực hiện logout khỏi Admin Panel
 * - /api/admin/auth/loggedin-user : lấy thông tin user đã login vào Admin Panel (API này dùng để check có Admin user đang login trên Admin Panel hay ko)
 */
const authRoutes = require("./auth_admin_routes");
router.use("/auth", authRoutes);


/**
 * ADMIN ACCOMMODATION
 * /api/admin/accommodations/*
 */
const accommodationAdminRoutes = require("./accommodation_admin_routes");
router.use("/accommodations", requireAdminLogin, accommodationAdminRoutes);


/**
 * ADMIN ROOM-TYPE
 * /api/admin/room-types/*
 */
//const roomTypeAdminRoutes = require("./roomType_admin_routes");
//router.use("/room-types", requireAdminLogin, roomTypeAdminRoutes);


/**
 * ADMIN LOCATIONS
 * /api/admin/locations/*
 */
const locationAdminRoutes = require("./location_admin_routes");
router.use("/locations", requireAdminLogin, locationAdminRoutes);

/**
 * ADMIN ATTRACTIONS
 * /api/admin/attractions/*
 */
const attractionAdminRoutes = require("./attraction_admin_routes");
router.use("/attractions", requireAdminLogin, attractionAdminRoutes);

const amenityAdminRoutes = require("./amenity_admin_routes");
router.use("/amenities", requireAdminLogin, amenityAdminRoutes);




module.exports = router;