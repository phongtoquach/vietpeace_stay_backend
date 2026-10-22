const authService = require("../../../services/auth_service");


async function login(req, res) {
    console.log("[authController - login] Value của req.body : ", req.body);

    const loginResult = await authService.login(req.body, "admin");
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
    const loginUserData =  {
        id: loginResult.user.id,
        email: loginResult.user.email,
        fullName: loginResult.user.full_name,
        displayName: loginResult.user.display_name,
        role: loginResult.user.role,
        status: loginResult.user.status
    };

    // tạo session admin (đây là session authen)
    req.session.admin = loginUserData;
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
            loginUserData: loginUserData
        }
    });
}


async function getLoggedInAdminUser(req, res) {
    return res.json({
        success: true,
        message: "Get logged-in admin user successfully",
        data: {
            userInfo: req.session.admin
        }
    });
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

        console.log("[logout] Xoa cookie vietpeace.admin.sid !");
        res.clearCookie("vietpeace.admin.sid",
            {
                path: "/api/admin",
            }
        );

        console.log("[logout] Return voi status code 200 & message thong bao logout thanh cong !");
        return res.status(200).json({
            success: true,
            message: "Đăng xuất user khỏi Admin Panel thành công",
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