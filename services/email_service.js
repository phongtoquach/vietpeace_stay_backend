const nodemailer = require('nodemailer');

function createVerificationSender() {
    const env = process.env;
    if (!env.SMTP_HOST || !env.SMTP_PORT || !env.MAIL_FROM || !env.CUSTOMER_WEB_VERIFY_URL) {
        throw new Error('Email configuration is incomplete');
    }
    const url = new URL(env.CUSTOMER_WEB_VERIFY_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash ||
        (env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
        throw new Error('Invalid Customer Web verification URL');
    }
    const port = Number(env.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
        throw new Error('Invalid SMTP configuration');
    }
    const secure = env.SMTP_SECURE === 'true';
    const transport = nodemailer.createTransport({
        host: env.SMTP_HOST, port, secure, requireTLS: !secure,
        ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true
    });
    return async (email, token) => {
        // Fragment keeps the secret out of HTTP access logs and Referer headers.
        const link = new URL(url);
        link.hash = new URLSearchParams({ token }).toString();
        try {
            const result = await transport.sendMail({
                from: env.MAIL_FROM, to: email,
                subject: 'Xác minh tài khoản VietPeaceStay',
                text: `Xác minh tài khoản VietPeaceStay bằng cách mở đường dẫn:\n${link.href}\n\nĐường dẫn có hiệu lực trong 24 giờ và chỉ sử dụng một lần. Nếu bạn không đăng ký, hãy bỏ qua email này.`
            });
            if (!result.accepted?.length || result.rejected?.length) throw new Error('Email was not accepted');
        } finally {
            transport.close();
        }
    };
}
module.exports = { createVerificationSender };
