const accommodationDetailService = require("../../../services/accommodation_detail_service");

async function getAccommodationDetailByAccommodationId(req, res) {
    try {
        console.log("[getAccommodationDetailByAccommodationId] Data của req.params : ", req.params);

        const rawId = req.params.accommodationId;
        const accommodationId = Number(rawId);

        if (!/^[1-9]\d*$/.test(rawId) || accommodationId > 2147483647) {
            return res.status(400).json({
                success: false,
                errorCode: "DATA_INVALID",
                errorMsg: "accommodationId phải là số nguyên dương.",
            });
        }

        console.log("[getAccommodationDetailByAccommodationId] Chuan bi get accommodation detail của accommodationId : " + accommodationId);

        const accommodation_data = await accommodationDetailService.getAccommodationDetailById(accommodationId);

        console.log("[getAccommodationDetailByAccommodationId] Data của accommodation_data sau khi goi ham service getAccommodationDetailById() :");
        console.log(accommodation_data);

        if (!accommodation_data) {
            return res.status(404).json({
                success: false,
                errorCode: "ACCOMMODATION_NOT_FOUND",
                errorMsg: "Không tìm thấy cơ sở lưu trú.",
            });
        }

        return res.json({
            success: true,
            message: "Successful",
            data: {
                accommodationData: accommodation_data
            }
        });
    } catch (error) {
        console.error("[accommodation-detail]", error);

        return res.status(500).json({
            success: false,
            errorCode: "INTERNAL_SERVER_ERROR",
            errorMsg: "Không thể tải thông tin cơ sở lưu trú lúc này.",
        });
    }
}


// export
module.exports = {
    getAccommodationDetailByAccommodationId
};