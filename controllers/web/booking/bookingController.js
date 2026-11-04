const bookingWebService = require("../../../services/booking_web_service");

async function getBookingPreview(req, res) {
    try {
        const body = req.body;

        console.log("[getBookingPreview] Data của req.body : ");
        console.log(body);

        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(200).json({
                success: false,
                errorCode: "DATA_INVALID",
                errorMsg: "Body phải là một JSON object.",
            });
        }

        const data = await bookingWebService.getBookingPreview(
            body,
            req.session?.customer?.id
        );

        if (!data) {
            return res.status(200).json({
                success: false,
                errorCode: "ACCOMMODATION_NOT_FOUND",
                errorMsg: "Không tìm thấy cơ sở lưu trú.",
            });
        }

        return res.json({ success: true, data });
    } catch (error) {
        if (error.statusCode === 400) {
            return res.status(200).json({
                success: false,
                errorCode: "DATA_INVALID",
                errorMsg: error.message,
            });
        }

        console.error("[booking-preview]", error);

        return res.status(200).json({
            success: false,
            errorCode: "INTERNAL_SERVER_ERROR",
            errorMsg: "Không thể tải thông tin cơ sở lưu trú lúc này.",
        });
    }
}


// export
module.exports = {
    getBookingPreview
};