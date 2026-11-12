const userWebService = require('../../../services/user_web_service');

async function verify(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
        if (!await userWebService.verifyEmail(req.body?.token)) {
            return res.status(400).json({
                success: false,
                message: 'Mã xác minh không hợp lệ, đã hết hạn hoặc đã được sử dụng.'
            });
        }
        return res.status(200).json({ success: true, message: 'Xác minh tài khoản thành công. Bạn có thể đăng nhập.' });
    } catch {
        return res.status(500).json({ success: false, message: 'Không thể xác minh lúc này. Vui lòng thử lại sau.' });
    }
}
module.exports = { verify };
