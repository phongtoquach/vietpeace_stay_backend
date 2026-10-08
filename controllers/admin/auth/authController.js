//const authService = require("./auth.service");


async function login(req, res) {
    const userData = {
        id: 207,
        email: "cuongnguyen_207@gmail.com",
        username: "cuong_vannn",
        fullname: "Nguyen Van Cuong"
    };

    req.session.admin = userData;

    return res.json({
        success: true,
        message: "Đăng nhập thành công",
        data: {
            loginUserInfo: userData,
        }
    });

    try {
        const { email, password } = req.body;

        const customer =
            await authService.loginCustomer(
                email,
                password
            );

        req.session.regenerate((err) => {
            if (err) {
                return res.status(302).json({
                    success: false,
                    message: "Regenerate session failed"
                });
            }

            req.session.customer = {
                id: customer.id,
            };

            req.session.save((err) => {
                if (err) {
                    return res.status(302).json({
                        success: false,
                        message: "Save session failed"
                    });
                }

                return res.json({
                    success: true,
                    message: "Đăng nhập thành công",

                    customer: {
                        id: customer.id,
                        name: customer.name,
                        email: customer.email,
                    },
                });
            });
        });

    } catch (error) {
        return res.status(302).json({
            success: false,
            message: "Login failed"
        });
    }
}


async function getLoggedInAdminUser(req, res) {
    return res.json({
        success: true,
        message: "Get logged-in admin user successfully",
        data: {
            userInfo: req.session.admin
        }
    });

    try {
        const customerId =
            req.session.customer.id;

        const customer =
            await authService.getCustomerById(
                customerId
            );

        res.json({
            success: true,
            customer,
        });

    } catch (error) {
        return res.status(404).json({
            success: false,
            message: "Loggedin user not found !"
        });
    }
}


async function logout(req, res) {
    req.session.destroy((err) => {
        if (err) {
            return res.status(302).json({
                success: false,
                message: err
            });
        }

        res.clearCookie(
            "vietpeace.customer.sid",
            {
                path: "/api/web",
            }
        );

        return res.json({
            success: true,
            message: "Đăng xuất thành công",
        });
    });
}


// async function forgotPassword(req, res) {
//     try {
//         // TODO:
//         // 1. nhận email
//         // 2. kiểm tra customer
//         // 3. tạo reset token
//         // 4. lưu token
//         // 5. gửi email

//         res.json({
//             success: true,
//             message:
//                 "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.",
//         });

//     } catch (error) {
//         return res.status(302).json({
//             success: false,
//             message: "Loggedin user not found !"
//         });
//     }
// }


async function resetPassword(req, res) {
    try {
        // TODO:
        // 1. verify token
        // 2. hash password mới
        // 3. update DB
        // 4. invalidate reset token

        res.json({
            success: true,
            message:
                "Đặt lại mật khẩu thành công.",
        });

    } catch (error) {
        return res.status(404).json({
            success: false,
            message: "Loggedin user not found !"
        });
    }
}


module.exports = {
    login,
    getLoggedInAdminUser,
    logout,
    resetPassword,
};