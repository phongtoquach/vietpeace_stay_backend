// Customer Web registration. Shared authentication keeps a compatibility export.
const sql = require("mssql");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { createVerificationSender } = require("./email_service");
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

        const user = result.recordset[0];
        let emailSent = false;
        try {
            const send = createVerificationSender();
            const token = crypto.randomBytes(32).toString("hex");
            const hash = crypto.createHash("sha256").update(token).digest("hex");
            await pool.request()
                .input("user_id", sql.UniqueIdentifier, user.id)
                .input("email", sql.VarChar(255), user.email)
                .input("token_hash", sql.Char(150), hash)
                .query(`
                    DECLARE @now datetime2 = SYSUTCDATETIME();
                    INSERT INTO dbo.email_verification_tokens
                        (user_id, email, token_hash, expires_at, created_at)
                    VALUES (@user_id, @email, @token_hash, DATEADD(HOUR, 24, @now), @now);
                `);
            await send(user.email, token);
            emailSent = true;
        } catch {
            // User INSERT already succeeded. Keep status 0 and never claim mail was sent.
            // No raw SMTP/database errors or tokens are included in logs or responses.
        }
        return {
            success: true,
            user: generatePublicUserInfo(user),
            verification: { required: true, emailSent }
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

async function verifyEmail(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const tx = new sql.Transaction(getDBPool());
    await tx.begin();
    try {
        const candidate = await new sql.Request(tx)
            .input("token_hash", sql.Char(150), hash)
            .query(`SELECT user_id FROM dbo.email_verification_tokens WHERE token_hash = @token_hash;`);
        if (!candidate.recordset.length) {
            await tx.commit();
            return false;
        }
        const userId = candidate.recordset[0].user_id;
        // Serialize verification for a user, including requests with different tokens.
        const user = await new sql.Request(tx)
            .input("user_id", sql.UniqueIdentifier, userId)
            .query(`SELECT id FROM dbo.users WITH (UPDLOCK, HOLDLOCK)
                WHERE id = @user_id AND role = 'CUSTOMER' AND status = 0;`);
        if (!user.recordset.length) {
            await tx.commit();
            return false;
        }
        const consumed = await new sql.Request(tx)
            .input("user_id", sql.UniqueIdentifier, userId)
            .input("token_hash", sql.Char(150), hash)
            .query(`
                DECLARE @now datetime2 = SYSUTCDATETIME();
                UPDATE t SET used_at = @now
                OUTPUT INSERTED.id
                FROM dbo.email_verification_tokens t
                JOIN dbo.users u ON u.id = t.user_id AND u.email = t.email
                WHERE t.user_id = @user_id AND t.token_hash = @token_hash
                    AND t.used_at IS NULL AND t.revoked_at IS NULL
                    AND t.expires_at > @now AND t.created_at <= @now;
            `);
        if (!consumed.recordset.length) {
            await tx.commit();
            return false;
        }
        const activated = await new sql.Request(tx)
            .input("user_id", sql.UniqueIdentifier, userId)
            .query(`UPDATE dbo.users SET status = 1
                OUTPUT INSERTED.id
                WHERE id = @user_id AND role = 'CUSTOMER' AND status = 0;`);
        if (activated.recordset.length !== 1) throw new Error("Account activation failed");
        await tx.commit();
        return true;
    } catch (error) {
        try { await tx.rollback(); } catch { /* Preserve original failure. */ }
        throw error;
    }
}

module.exports = { register, verifyEmail };
