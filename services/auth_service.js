const sql = require("mssql");
const bcrypt = require("bcryptjs");

const { getDBPool } = require("../configs/database");

const EMAIL_REGEX =
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const LOGIN_ROLES = {
    web: ["CUSTOMER"],
    admin: ["ADMIN", "ACCOMMODATION_MANAGER"]
};

function failure(errorCode, errorMsg = "", errors = {}) {
    return {
        success: false,
        errorCode,
        errorMsg,
        errors
    };
}

function isValidBody(body) {
    return (
        body !== null &&
        typeof body === "object" &&
        !Array.isArray(body)
    );
}

function validateCredentials(body) {
    const errors = {};

    const email = typeof body.email === "string" ? body.email.trim() : "";

    // Không trim password vì khoảng trắng có thể thuộc password.
    const password = typeof body.password === "string" ? body.password : "";

    if (!email) {
        errors.email = "Vui lòng nhập email.";
    } else if (email.length > 255) {
        errors.email = "Email không được vượt quá 255 ký tự.";
    } else if (!EMAIL_REGEX.test(email)) {
        errors.email = "Email không đúng định dạng.";
    }

    if (!password) {
        errors.password = "Vui lòng nhập mật khẩu.";
    } else if (password.length < 8) {
        errors.password = "Mật khẩu phải có ít nhất 8 ký tự.";
    }

    return {
        email,
        password,
        errors
    };
}

// Chỉ trả những thuộc tính được phép đưa ra frontend.
function generatePublicUserInfo(user) {
    return {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        display_name: user.display_name,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        role: user.role,
        status: user.status,
        last_login_at: user.last_login_at
    };
}

/**
 * body: { email, password }
 * audience: "web" hoặc "admin", do controller truyền vào.
 */
async function login(body, audience = "web") {
    console.log("[auth_service - login()] Đang chạy hàm login() ! audience : " + audience + " ; body data : ", body);
    
    if (!isValidBody(body)) {
        return failure("REQUEST_BODY_INVALID","Request body không hợp lệ.");
    }

    if (audience !== "web" && audience !== "admin") {
        // Lỗi lập trình: controller truyền sai audience.
        //throw new Error("Login audience không hợp lệ.");

        return failure("LOGIN_AUDIENCE_INVALID","Login audience không hợp lệ");
    }

    const { email, password, errors } = validateCredentials(body);
    console.log("[auth_service - login()] Kết quả hàm validateCredentials() : ");
    console.log("[auth_service - login()] email : " + email + " ; password : " + password);
    console.log("[auth_service - login()] errors : ", errors);

    if (Object.keys(errors).length > 0) {
        return failure("DATA_INVALID", "Dữ liệu không hợp lệ.", errors);
    }

    const pool = getDBPool();

    const result = await pool
        .request()
        .input("email", sql.VarChar(255), email)
        .query(`
            SELECT
                id,
                email,
                full_name,
                display_name,
                password_hash,
                phone_number,
                avatar_url,
                role,
                status,
                last_login_at
            FROM dbo.users
            WHERE email = @email;
        `);

    if (result.recordset.length === 0) {
        return failure(
            "USER_EMAIL_NOT_EXISTED",
            "Email không tồn tại trong hệ thống.",
            {
                email: "Email không tồn tại trong hệ thống.",
            }
        );
    }

    const user = result.recordset[0];
    console.log("[auth_service - login()] Data của user vừa lấy ra : ", user);

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
        return failure(
            "WRONG_PASSWORD",
            "Mật khẩu không chính xác.",
            {
                password: "Mật khẩu không chính xác.",
            }
        );
    }

    // Chỉ kiểm tra và thông báo trạng thái khi password đã đúng.
    if (user.status === 0) {
        return failure(
            "EMAIL_NOT_VERIFIED",
            "Tài khoản chưa được xác thực email."
        );
    }

    if (user.status === 2) {
        return failure(
            "ACCOUNT_INACTIVE",
            "Tài khoản đã ngừng hoạt động."
        );
    }

    if (user.status !== 1) {
        return failure(
            "ACCOUNT_STATUS_INVALID",
            "Trạng thái tài khoản không hợp lệ."
        );
    }

    const allowedRoles = LOGIN_ROLES[audience];
    console.log("[auth_service - login()] allowedRoles - các role được cho phép login vào admin panel : ", allowedRoles)

    if (!allowedRoles.includes(user.role)) {
        return failure("LOGIN_FORBIDDEN", "Tài khoản này không có quyền đăng nhập vào " + ((audience === "admin") ? "Hệ thống quản trị !" : "Website đặt phòng !"));
    }

    const updateResult = await pool
        .request()
        .input("id", sql.UniqueIdentifier, user.id)
        .query(`
            UPDATE dbo.users SET last_login_at = SYSDATETIME()
            OUTPUT INSERTED.last_login_at
            WHERE id = @id;
        `);

    user.last_login_at = updateResult.recordset[0].last_login_at ? updateResult.recordset[0].last_login_at.toISOString().slice(0, 19).replace("T", " ") : "";

    return {
        success: true,
        user: generatePublicUserInfo(user)
    };
}

/**
 * body:
 * {
 *     email,
 *     password,
 *     full_name,
 *     display_name,
 *     phone_number // không bắt buộc
 * }
 */
async function register(body) {
    if (!isValidBody(body)) {
        return failure(
            "DATA_INVALID",
            "Request body không hợp lệ."
        );
    }

    const { email, password, errors } =
        validateCredentials(body);

    const fullName =
        typeof body.full_name === "string"
            ? body.full_name.trim()
            : "";

    const displayName =
        typeof body.display_name === "string"
            ? body.display_name.trim()
            : "";

    let phoneNumber = null;

    if (!fullName) {
        errors.full_name = "Vui lòng nhập họ tên.";
    } else if (fullName.length > 255) {
        errors.full_name =
            "Họ tên không được vượt quá 255 ký tự.";
    }

    if (!displayName) {
        errors.display_name = "Vui lòng nhập tên hiển thị.";
    } else if (displayName.length > 255) {
        errors.display_name =
            "Tên hiển thị không được vượt quá 255 ký tự.";
    }

    if (
        body.phone_number !== undefined &&
        body.phone_number !== null
    ) {
        if (typeof body.phone_number !== "string") {
            errors.phone_number =
                "Số điện thoại phải là chuỗi.";
        } else {
            phoneNumber = body.phone_number.trim() || null;

            if (phoneNumber && phoneNumber.length > 20) {
                errors.phone_number =
                    "Số điện thoại không được vượt quá 20 ký tự.";
            }
        }
    }

    // bcrypt chỉ xử lý tối đa 72 byte password.
    if (
        !errors.password &&
        Buffer.byteLength(password, "utf8") > 72
    ) {
        errors.password =
            "Mật khẩu không được vượt quá 72 byte UTF-8.";
    }

    if (Object.keys(errors).length > 0) {
        return failure(
            "DATA_INVALID",
            "Dữ liệu không hợp lệ.",
            errors
        );
    }

    const pool = getDBPool();

    const existingResult = await pool
        .request()
        .input("email", sql.VarChar(255), email)
        .query(`
            SELECT id
            FROM dbo.users
            WHERE email = @email;
        `);

    if (existingResult.recordset.length > 0) {
        return failure(
            "EMAIL_ALREADY_EXISTS",
            "Email đã được sử dụng.",
            {
                email: "Email đã được sử dụng.",
            }
        );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    try {
        const result = await pool
            .request()
            .input("email", sql.VarChar(255), email)
            .input("full_name", sql.NVarChar(255), fullName)
            .input("display_name", sql.NVarChar(255), displayName)
            .input("password_hash", sql.VarChar(255), passwordHash)
            .input("phone_number", sql.VarChar(20), phoneNumber)
            .query(`
                INSERT INTO dbo.users (
                    email,
                    full_name,
                    display_name,
                    password_hash,
                    phone_number,
                    role,
                    status
                )
                OUTPUT
                    INSERTED.id,
                    INSERTED.email,
                    INSERTED.full_name,
                    INSERTED.display_name,
                    INSERTED.phone_number,
                    INSERTED.avatar_url,
                    INSERTED.role,
                    INSERTED.status,
                    INSERTED.email_verified_at,
                    INSERTED.last_login_at,
                    INSERTED.created_at
                VALUES (
                    @email,
                    @full_name,
                    @display_name,
                    @password_hash,
                    @phone_number,
                    'CUSTOMER',
                    0
                );
            `);

        return {
            success: true,
            user: generatePublicUserInfo(result.recordset[0]),
        };
    } catch (error) {
        const errorNumber =
            error.number ??
            error.originalError?.info?.number;

        // Hai request đồng thời có thể cùng vượt qua SELECT.
        // UNIQUE constraint sẽ chặn request insert trùng email.
        if (errorNumber === 2601 || errorNumber === 2627) {
            return failure(
                "EMAIL_ALREADY_EXISTS",
                "Email đã được sử dụng.",
                {
                    email: "Email đã được sử dụng.",
                }
            );
        }

        // Lỗi hệ thống để controller bắt.
        throw error;
    }
}

/**
 * Controller truyền req.session vào.
 * Controller chịu trách nhiệm clear cookie.
 */
async function logout(session) {
    if (session) {
        await new Promise((resolve, reject) => {
            session.destroy((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    return {
        success: true,
    };
}

module.exports = {
    login,
    register,
    logout,
};