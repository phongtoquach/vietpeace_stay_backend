function requireCustomerLogin(req, res, next) {
    console.log("[requireCustomerLogin] req.session : ", req.session);

    if (!req.session.customer) {
        return res.status(401).json({
            success: false,
            message: "Vui lòng đăng nhập vào website",
        });
    }

    next();
}

module.exports = requireCustomerLogin;