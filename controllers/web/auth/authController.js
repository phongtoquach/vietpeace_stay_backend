const authService = require("../../../services/auth_service");
const userWebService = require("../../../services/user_web_service");


async function login(req, res) {
    console.log("[authController - login] Value của req.body : ", req.body);

    const loginResult = await authService.login(req.body, "web");
    console.log("[authController - login] Ket qua hàm authService.login() : ", loginResult);

    if (!loginResult.success) {
        //const statusCode = LOGIN_ERROR_HTTP_STATUS[result.errorCode] ?? 400;
        return res.json({
            success: false,
            message: loginResult.errorMsg,
            errorCode: loginResult.errorCode,
            errors: loginResult.errors
        });
    }

    // Đổi session ID sau khi xác thực thành công.
    await new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

    
    // chuẩn bị login user data
    const customerData = {
        id: loginResult.user.id,
        email: loginResult.user.email,
        fullName: loginResult.user.full_name,
        displayName: loginResult.user.display_name,
        role: loginResult.user.role,
        status: loginResult.user.status
    };

    // tạo session customer (đây là session authen)
    req.session.customer = customerData;
    // Chờ lưu session thành công rồi mới trả response.
    await new Promise((resolve, reject) => {
        req.session.save((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

    return res.status(200).json({
        success: true,
        message: "Đăng nhập thành công",
        data: {
            loginCustomerInfo: customerData,
        }
    });
}


async function register(req, res) {
    try {
        const result = await userWebService.register(req.body);

        if (!result.success) {
            if (result.errorCode === "EMAIL_ALREADY_EXISTS") {
                return res.status(409).json({
                    success: false,
                    message: "Địa chỉ Email này đã được sử dụng! Vui lòng nhập email khác!"
                });
            }

            if (result.errorCode === "DATA_INVALID") {
                return res.status(400).json({
                    success: false,
                    message: result.errorMsg,
                    errors: result.errors
                });
            }

            throw new Error("Unexpected registration result");
        }

        return res.status(201).json({
            success: true,
            message: result.verification.emailSent
                ? "Đăng ký thành công. Vui lòng kiểm tra email để xác minh tài khoản."
                : "Tài khoản đã được tạo nhưng chưa gửi được email xác minh. Tài khoản chưa được kích hoạt. Vui lòng liên hệ hỗ trợ.",
            verification: result.verification,
            customer: {
                id: result.user.id,
                name: result.user.full_name,
                email: result.user.email
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Không thể đăng ký lúc này. Vui lòng thử lại sau."
        });
    }
}


async function getLoggedInUser(req, res) {
    return res.json({
        success: true,
        message: "Get logged-in user successfully",
        data: {
            customerInfo: req.session.customer
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
            console.log("[logout] Xoa session that bai ! Error : ", err);
            return res.status(500).json({
                success: false,
                message: err
            });
        }

        console.log("[logout] Xoa session thanh cong !");

        console.log("[logout] Xoa cookie vietpeace.customer.sid !");
        res.clearCookie("vietpeace.customer.sid",
            {
                path: "/api/web",
            }
        );

        console.log("[logout] Return voi status code 200 & message thong bao logout thanh cong !");
        return res.status(200).json({
            success: true,
            message: "Đăng xuất customer khỏi web thành công",
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
    register,
    getLoggedInUser,
    logout,
    resetPassword,
};