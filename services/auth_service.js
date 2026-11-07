const sql = require("mssql");
const bcrypt = require("bcryptjs");

const { getDBPool } = require("../configs/database");

const EMAIL_REGEX =
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const ADMIN_PANEL_ROLES = Object.freeze(["ADMIN", "ACCOMMODATION_MANAGER"]);

const LOGIN_ROLES = {
    web: ["CUSTOMER"],
    admin: ADMIN_PANEL_ROLES
};

function isAdminPanelRole(role) {
    return ADMIN_PANEL_ROLES.includes(role);
}

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
        personal_email: user.personal_email || null,
        full_name: user.full_name,
        display_name: user.display_name,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        role: user.role,
        status: user.status,
        must_change_password: Boolean(user.must_change_password),
        accommodationId: user.accommodationId ?? null,
        accommodationName: user.accommodationName ?? null,
        last_login_at: user.last_login_at
    };
}

/**
 * body: { email, password }
 * audience: "web" hoặc "admin", do controller truyền vào.
 */
async function login(body, audience = "web") {
    console.log("[auth_service - login()] audience : " + audience);
    
    if (!isValidBody(body)) {
        return failure("REQUEST_BODY_INVALID", "Request body không hợp lệ.");
    }

    if (audience !== "web" && audience !== "admin") {
        return failure("LOGIN_AUDIENCE_INVALID", "Login audience không hợp lệ");
    }

    const { email, password, errors } = validateCredentials(body);

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
                personal_email,
                full_name,
                display_name,
                password_hash,
                phone_number,
                avatar_url,
                role,
                status,
                must_change_password,
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
    console.log("[auth_service - login()] User lookup completed for email : " + email);

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
            "Tài khoản đã ngừng hoạt động hoặc đã bị thu hồi quyền truy cập."
        );
    }

    if (user.status !== 1) {
        return failure(
            "ACCOUNT_STATUS_INVALID",
            "Trạng thái tài khoản không hợp lệ."
        );
    }

    const allowedRoles = LOGIN_ROLES[audience];

    if (!allowedRoles.includes(user.role)) {
        return failure("LOGIN_FORBIDDEN", "Tài khoản này không có quyền đăng nhập vào " + ((audience === "admin") ? "Hệ thống quản trị !" : "Website đặt phòng !"));
    }

    // Kiểm tra phạm vi cơ sở lưu trú của Manager
    if (user.role === "ACCOMMODATION_MANAGER") {
        const mgrCheck = await pool.request()
            .input("userId", sql.UniqueIdentifier, user.id)
            .query(`
                SELECT m.accommodation_id, a.accommodation_name
                FROM dbo.accommodation_managers m
                INNER JOIN dbo.accommodations a ON a.id = m.accommodation_id AND a.deleted_at IS NULL
                WHERE m.user_id = @userId;
            `);

        if (mgrCheck.recordset.length === 0) {
            return failure("ACCOMMODATION_NOT_ASSIGNED", "Tài khoản của bạn chưa được phân công cơ sở lưu trú nào hoặc quyền quản lý đã bị thu hồi.");
        }

        user.accommodationId = mgrCheck.recordset[0].accommodation_id;
        user.accommodationName = mgrCheck.recordset[0].accommodation_name;
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

async function getAdminUserById(userId) {
    const pool = getDBPool();

    const result = await pool
        .request()
        .input("id", sql.UniqueIdentifier, userId)
        .query(`
            SELECT
                u.id,
                u.email,
                u.personal_email,
                u.full_name,
                u.display_name,
                u.role,
                u.status,
                u.must_change_password,
                m.accommodation_id AS manager_accommodation_id,
                ma.accommodation_name AS manager_accommodation_name
            FROM dbo.users u
            LEFT JOIN dbo.accommodation_managers m ON m.user_id = u.id
            LEFT JOIN dbo.accommodations ma ON ma.id = m.accommodation_id AND ma.deleted_at IS NULL
            WHERE u.id = @id;
        `);

    const user = result.recordset[0];
    if (!user) return null;

    let isRevoked = false;
    if (user.role === "ACCOMMODATION_MANAGER") {
        if (!user.manager_accommodation_id) {
            isRevoked = true;
        } else {
            user.accommodationId = user.manager_accommodation_id;
            user.accommodationName = user.manager_accommodation_name;
        }
    }

    user.isRevoked = isRevoked;
    user.must_change_password = Boolean(user.must_change_password);
    return user;
}

/**
 * Đổi mật khẩu lần đầu (bắt buộc đối với tài khoản cấp phát tạm thời)
 */
async function changeInitialPassword(userId, newPassword) {
    if (!newPassword || typeof newPassword !== "string" || newPassword.trim().length < 8) {
        return failure("PASSWORD_TOO_SHORT", "Mật khẩu mới phải có ít nhất 8 ký tự.", {
            newPassword: "Mật khẩu mới phải có ít nhất 8 ký tự."
        });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword.trim(), salt);

    const pool = getDBPool();
    const result = await pool.request()
        .input("id", sql.UniqueIdentifier, userId)
        .input("passwordHash", sql.VarChar(255), passwordHash)
        .query(`
            UPDATE dbo.users
            SET password_hash = @passwordHash,
                must_change_password = 0,
                password_change_at = SYSDATETIME(),
                updated_at = SYSDATETIME()
            OUTPUT INSERTED.id, INSERTED.email, INSERTED.must_change_password
            WHERE id = @id;
        `);

    if (result.recordset.length === 0) {
        return failure("USER_NOT_FOUND", "Không tìm thấy thông tin người dùng.");
    }

    return {
        success: true,
        message: "Đổi mật khẩu thành công. Tài khoản của bạn đã được kích hoạt hoàn toàn."
    };
}

// Compatibility for existing callers; registration belongs to Customer Web.
const { register } = require("./user_web_service");

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
    getAdminUserById,
    changeInitialPassword,
    isAdminPanelRole,
};
