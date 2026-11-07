// Customer Web registration. Shared authentication keeps a compatibility export.
const sql = require("mssql");
const bcrypt = require("bcryptjs");
const { getDBPool } = require("../configs/database");
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

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
        validateCredentials({
            ...body,
            email: typeof body.email === "string" ? body.email.trim().toLowerCase() : body.email
        });

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
            "Địa chỉ Email này đã được sử dụng! Vui lòng nhập email khác!",
            {
                email: "Địa chỉ Email này đã được sử dụng! Vui lòng nhập email khác!",
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
        // Verified on VietPeaceStay.dbo.users: unfiltered UNIQUE key on email.
        // Match the constraint/index position, never text in the duplicate value.
        const emailKey = "UQ__users__AB6E6164E77901F7";
        const sqlErrors = [error, error.originalError?.info, ...(error.precedingErrors || [])];
        const isEmailConflict = sqlErrors.some((sqlError) => {
            if (!sqlError) return false;
            const { number, message = "" } = sqlError;
            return (
                (number === 2627 && message.startsWith(`Violation of UNIQUE KEY constraint '${emailKey}'. Cannot insert duplicate key in object 'dbo.users'.`)) ||
                (number === 2601 && message.startsWith(`Cannot insert duplicate key row in object 'dbo.users' with unique index '${emailKey}'.`))
            );
        });

        if (isEmailConflict) {
            return failure(
                "EMAIL_ALREADY_EXISTS",
                "Địa chỉ Email này đã được sử dụng! Vui lòng nhập email khác!",
                {
                    email: "Địa chỉ Email này đã được sử dụng! Vui lòng nhập email khác!",
                }
            );
        }

        // Lỗi hệ thống để controller bắt.
        throw error;
    }
}

module.exports = { register };
