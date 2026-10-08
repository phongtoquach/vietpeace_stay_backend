function requireAdminLogin(req, res, next) {
    console.log("[requireAdminLogin] req.session : ", req.session);

    if (!req.session.admin) {
        return res.status(401).json({
            success: false,
            message: "Vui lòng đăng nhập vào Admin Panel",
        });
    }

    next();
}

module.exports = requireAdminLogin;