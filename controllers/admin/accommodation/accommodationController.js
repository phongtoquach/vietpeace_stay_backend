async function getAccommodationsList(req, res) {
    res.json({
        success: true,
        message: "successful",
        data: {
            accommodationsList: [
                {
                    accommId: 102,
                    accommName: "Hạ Long Luxury Riverside Hotel"
                },
                {
                    accommId: 105,
                    accommName: "Cần Thơ Green Home"
                }
            ]
        }
    });
}

// Lấy thông tin chi tiết 1 Accommodation theo Accommodation ID
async function getAccommodationDetail(req, res) {
    res.json({
        success: true,
        message: "successful",
        data: {
            accommodationDetail: {
                accommId: 102,
                accommName: "Hạ Long Luxury Riverside Hotel"
            }
        }
    });
}


// export
module.exports = {
    getAccommodationsList,
    getAccommodationDetail
};