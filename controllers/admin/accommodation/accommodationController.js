const accommodationService = require('../../../services/accommodation_service');
const { ok, fail } = require('../../../utils/response');

/**
 * GET /api/admin/accommodations
 *
 * Nhiệm vụ của controller:
 * 1. Nhận request từ route.
 * 2. Gửi query và user hiện tại cho service.
 * 3. Nhận dữ liệu từ service.
 * 4. Trả JSON cho frontend.
 *
 * Controller không viết SQL.
 */

async function getAccommodationsList(req, res) {
    try {
        /*
         * req.query chứa các tham số trên URL:
         *
         * ?page=1
         * ?limit=10
         * ?status=1
         */
        const result = await accommodationService.getAccommodationList(req.query, req.session.admin);
        /*
         * result đã có:
         * - items
         * - pagination
         */
        return ok(res, result, "Lấy danh sách cơ sở lưu trú thành công.");
    } catch (error) {
        console.error(
            "[getAccommodationsList] Lỗi lấy danh sách:",
            error
        );
        if (error.statusCode && error.errorCode) {
            return fail(
                res,
                error.statusCode,
                error.errorCode,
                error.message,
                error.errors
            );
        }
        return fail(
            res,
            500,
            "INTERNAL_ERROR",
            "Đã xảy ra lỗi khi lấy danh sách cơ sở lưu trú."
        );
    }
}

// Lấy thông tin chi tiết 1 Accommodation theo Accommodation ID
async function getAccommodationDetail(req, res) {
    return fail(
        res,
        501,
        "NOT_IMPLEMENTED",
        "API chi tiết chưa được triển khai.");
}


// export
module.exports = {
    getAccommodationsList,
    getAccommodationDetail
};