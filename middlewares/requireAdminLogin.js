const authService = require("../services/auth_service");

const ADMIN_SESSION_COOKIE_NAME = "vietpeace.admin.sid";
const ADMIN_SESSION_COOKIE_PATH = "/api/admin";

function sendUnauthenticated(res) {
    return res.status(401).json({
        success: false,
        message: "Vui lòng đăng nhập vào Admin Panel",
        errorCode: "UNAUTHENTICATED",
    });
}

async function revokeAdminSession(req, res) {
    await new Promise((resolve) => {
        req.session.destroy(() => resolve());
    });

    res.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
        path: ADMIN_SESSION_COOKIE_PATH,
    });
}

async function requireAdminLogin(req, res, next) {
    // Middleware được mount cả ở router cha lẫn route con.
    if (req.currentAdmin) {
        return next();
    }

    if (!req.session?.admin?.id) {
        return sendUnauthenticated(res);
    }

    try {
        const currentAdmin = await authService.getAdminUserById(req.session.admin.id);

        const sessionIsValid =
            currentAdmin &&
            currentAdmin.status === 1 &&
            authService.isAdminPanelRole(currentAdmin.role);

        // User bị xóa, inactive hoặc mất role admin: thu hồi phiên ngay.
        if (!sessionIsValid) {
            await revokeAdminSession(req, res);
            return sendUnauthenticated(res);
        }

        // Đồng bộ để middleware/controller phía sau không dùng role/status cũ.
        req.session.admin.role = currentAdmin.role;
        req.session.admin.status = currentAdmin.status;
        req.currentAdmin = currentAdmin;

        return next();
    } catch (error) {
        // Không log session, body hoặc credential.
        console.error("[requireAdminLogin] admin lookup failed:", error.code || "UNKNOWN");

        return res.status(500).json({
            success: false,
            message: "Không thể xác thực phiên đăng nhập.",
            errorCode: "AUTH_LOOKUP_FAILED",
        });
    }
}

module.exports = requireAdminLogin;
