const sql = require("mssql");
const { getDBPool } = require("../configs/database");

// Các hằng số trong Accommodation
const {
  ACCOMMODATION_STATUS_LABEL,
  SORT_FIELD_MAP,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require("../constants/accommodation");

// Format ngày giờ
const { formatTime, formatDateTime } = require("../utils/datetime");

/**
 * Lỗi riêng của service accommodation.
 *
 * Vì sao cần class này?
 * Service có thể phát hiện nhiều loại lỗi khác nhau:
 *
 * - Filter sai  → HTTP 400
 * - Không tìm thấy dữ liệu → HTTP 404
 * - Dữ liệu bị trùng → HTTP 409
 *
 * Controller sẽ đọc các thuộc tính này để trả response đúng chuẩn.
 */

class AccommodationServiceError extends Error {
  constructor(
    message,
    statusCode = 400,
    errorCode = "VALIDATION_ERROR",
    errors = undefined,
  ) {
    // Gọi constructor của Error gốc.
    super(message);

    // HTTP status muốn trả về frontend.
    this.statusCode = statusCode;

    // Mã lỗi
    this.errorCode = errorCode;

    // Lỗi theo từng field, ví dụ { status: "..." }.
    this.errors = errors;
  }
}

/**
 * Chuyển một giá trị query thành số nguyên dương.
 *
 * Ví dụ:
 * parsePositiveInt("10", 1)     → 10
 * parsePositiveInt("abc", 1)    → 1
 * parsePositiveInt("-2", 1)     → 1
 * parsePositiveInt(undefined, 1) → 1
 *
 * Dùng cho page, limit, locationId, provinceId...
 */

function parsePositiveInt(value, defaultValue = null) {
  const number = Number.parseInt(value, 10);

  // Nếu không phải số nguyên dương,
  // trả về giá trị mặc định.
  if (!Number.isInteger(number) || number <= 0) {
    return defaultValue;
  }

  return number;
}

/**
 * Chuẩn hóa page và limit từ URL.
 *
 * Quy tắc:
 * - page nhỏ nhất là 1
 * - limit mặc định là 10
 * - limit lớn nhất là 100
 * - offset dùng để SQL biết bỏ qua bao nhiêu dòng
 */
function parsePagination(query) {
  // Nếu page sai hoặc không có thì dùng page 1.
  const page = Math.max(1, parsePositiveInt(query.page, 1));

  // Nếu limit sai hoặc không có thì dùng limit mặc định.
  const requestedLimit = parsePositiveInt(query.limit, DEFAULT_PAGE_SIZE);

  // Không cho phép lấy quá MAX_PAGE_SIZE dòng một lần.
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedLimit));

  // Ví dụ:
  // page = 1, limit = 10 → offset = 0
  // page = 2, limit = 10 → offset = 10
  // page = 3, limit = 10 → offset = 20
  const offset = (page - 1) * limit;

  return {
    page,
    limit,
    offset,
  };
}

/**
 * Chuyển một dòng dữ liệu từ SQL Server
 * thành một object đúng Data Transfer Ojbect của frontend.
 *
 * Database:
 *   accommodation_name
 *
 * Frontend:
 *   name
 */
function mapSummaryRow(row) {
  return {
    // Thông tin cơ bản
    id: row.id,
    code: row.accommodation_code,
    name: row.accommodation_name,
    slug: row.slug,

    // Loại hình lưu trú.
    type: {
      id: row.accommodation_type_id,
      code: row.type_code,
      name: row.type_name,
    },

    // Điểm đến du lịch.
    location: {
      id: row.location_id,
      name: row.location_name,
    },

    // Tỉnh/thành.
    province: {
      id: row.province_id,
      name: row.province_name,
    },

    // Ward có thể không có dữ liệu nên cần trả null.
    ward: row.ward_id
      ? {
          id: row.ward_id,
          name: row.ward_name,
        }
      : null,

    // Thông tin hiển thị danh sách.
    addressLine: row.address_line,
    starRating: row.star_rating,
    status: row.status,

    // Ví dụ status = 1 → "Đang hoạt động".
    statusLabel: ACCOMMODATION_STATUS_LABEL[row.status] || null,

    // SQL Server trả BIT, chuyển rõ thành boolean JavaScript.
    isFeatured: Boolean(row.is_featured),

    // Nếu chưa có ảnh thì trả null,
    // frontend có thể hiển thị placeholder.
    coverImageUrl: row.cover_image_url || null,

    // COUNT từ SQL thường trả về số,
    // nhưng ép kiểu để DTO luôn ổn định.
    roomTypesCount: Number(row.room_types_count || 0),
    amenitiesCount: Number(row.amenities_count || 0),

    // Format DATETIME2 thành "YYYY-MM-DD HH:mm:ss".
    updatedAt: formatDateTime(row.updated_at),
  };
}

/**
 * Chuyển chuỗi CSV thành mảng số nguyên.
 *
 * Ví dụ:
 * "1,2,3" → [1, 2, 3]
 * ""       → []
 *
 * Dùng cho:
 * ?typeId=1,2
 * ?status=1,2
 */
function parseCsvInt(value, fieldName, { allowZero = false } = {}) {
  // Không có filter thì trả mảng rỗng.
  if (value === undefined || value === null || value === "") {
    return [];
  }

  // Tách chuỗi bằng dấu phẩy.
  const values = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  // Chuyển từng phần thành Number.
  const numbers = values.map((item) => Number(item));
  const minimum = allowZero ? 0 : 1;

  // status có giá trị 0 = Bản nháp, nên có thể cho phép số 0 có kiểm soát.
  const isInvalid = numbers.some(
    (number) => !Number.isInteger(number) || number < minimum,
  );

  if (isInvalid) {
    const ruleMessage = allowZero
      ? `${fieldName} phải là danh sách số nguyên không âm.`
      : `${fieldName} phải là danh sách số nguyên dương.`;

    throw new AccommodationServiceError(
      "Dữ liệu filter không hợp lệ.",
      400,
      "VALIDATION_ERROR",
      {
        [fieldName]: ruleMessage,
      },
    );
  }

  // Loại bỏ ID trùng nhau.
  return [...new Set(numbers)];
}

/**
 * Thêm điều kiện IN vào câu SQL.
 *
 * Ví dụ:
 * values = [1, 2]
 * column = "a.status"
 *
 * Kết quả:
 * a.status IN (@status0, @status1)
 */
function addCsvFilter({
  whereParts,
  params,
  column,
  values,
  parameterPrefix,
  sqlType,
}) {
  // Không có giá trị thì không thêm điều kiện.
  if (values.length === 0) {
    return;
  }

  // Tạo tên parameter cho từng giá trị.
  const placeholders = values.map((value, index) => {
    const parameterName = `${parameterPrefix}${index}`;

    // Lưu parameter để lát nữa gắn vào SQL request.
    params.push({
      name: parameterName,
      type: sqlType,
      value,
    });

    return `@${parameterName}`;
  });

  // Ví dụ kết quả:
  // a.status IN (@status0, @status1)
  whereParts.push(`${column} IN (${placeholders.join(", ")})`);
}

/**
 * Lấy danh sách accommodation từ database.
 *
 * query:
 * - q
 * - typeId
 * - locationId
 * - provinceId
 * - status
 * - isFeatured
 * - sortBy
 * - sortDir
 * - page
 * - limit
 *
 * currentUser:
 * - req.session.admin
 */
async function getAccommodationList(query = {}, currentUser = {}) {
  // Lấy connection pool tới SQL Server.
  const pool = getDBPool();
  // Đọc thông tin phân trang.
  const { page, limit, offset } = parsePagination(query);
  // Đọc các filter dạng danh sách.
  const typeIds = parseCsvInt(query.typeId, "typeId");
  // Status hợp lệ gồm 0 (draft), 1 (active), 2 (inactive).
  const statusIds = parseCsvInt(query.status, "status", { allowZero: true });

  // Đọc các filter chỉ có một ID.
  const locationId = parsePositiveInt(query.locationId);
  const provinceId = parsePositiveInt(query.provinceId);
  // Từ khóa tìm kiếm.
  const q = typeof query.q === "string" ? query.q.trim() : "";
  // isFeatured có 3 trạng thái:
  // true  → chỉ lấy nổi bật
  // false → chỉ lấy không nổi bật
  // null  → không lọc theo nổi bật
  const isFeatured =
    query.isFeatured === "true"
      ? true
      : query.isFeatured === "false"
        ? false
        : null;

  console.log("[getAccommodationList] Filter đầu vào:", {
    q: query.q ?? null,
    typeId: query.typeId ?? null,
    locationId: query.locationId ?? null,
    provinceId: query.provinceId ?? null,
    status: query.status ?? null,
    isFeatured: query.isFeatured ?? null,
    sortBy: query.sortBy ?? null,
    sortDir: query.sortDir ?? null,
    page: query.page ?? null,
    limit: query.limit ?? null,
  });

  console.log("[getAccommodationList] Filter sau khi parse:", {
    typeIds,
    statusIds,
    locationId,
    provinceId,
    isFeatured,
  });

  // Kiểm tra user hiện tại có phải ADMIN không.
  const isAdmin = currentUser.role === "ADMIN";

  // Chỉ ADMIN mới được xem dữ liệu đã xóa mềm.
  const includeDeleted = isAdmin && query.includeDeleted === "true";

  /*
   * sortBy là tên cột do frontend gửi lên.
   *
   * Không được đưa trực tiếp query.sortBy vào SQL.
   * Phải tra qua SORT_FIELD_MAP.
   */
  const requestedSortBy = String(query.sortBy || "sortOrder");

  const sortColumn =
    SORT_FIELD_MAP[requestedSortBy] || SORT_FIELD_MAP.sortOrder;

  /*
   * Chỉ chấp nhận desc.
   * Mọi giá trị khác đều dùng asc.
   */
  const sortDirection =
    String(query.sortDir || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

  // Khi sort theo id, không thêm a.id lần thứ hai trong ORDER BY.
  // Với các cột khác, a.id giữ thứ tự ổn định khi hai dòng có cùng giá trị.
  const tieBreaker = sortColumn === "a.id" ? "" : ", a.id ASC";

  // Mảng chứa từng điều kiện WHERE.
  const whereParts = [];

  // Mảng chứa các parameter SQL.
  const params = [];

  /*
   * Mặc định không lấy cơ sở đã xóa mềm.
   *
   * Đây là điều kiện bắt buộc theo AGENT.md.
   */
  if (!includeDeleted) {
    whereParts.push("a.deleted_at IS NULL");
  }

  /*
   * Tìm trong:
   * - tên cơ sở
   * - mã cơ sở
   * - địa chỉ
   */
  if (q) {
    whereParts.push(`
            (
                a.accommodation_name LIKE @q
                OR a.accommodation_code LIKE @q
                OR a.address_line LIKE @q
            )
        `);

    params.push({
      name: "q",
      type: sql.NVarChar(255),
      value: `%${q}%`,
    });
  }

  if (locationId) {
    whereParts.push("a.location_id = @locationId");

    params.push({
      name: "locationId",
      type: sql.Int,
      value: locationId,
    });
  }

  if (provinceId) {
    whereParts.push("a.province_id = @provinceId");

    params.push({
      name: "provinceId",
      type: sql.Int,
      value: provinceId,
    });
  }

  if (isFeatured !== null) {
    whereParts.push("a.is_featured = @isFeatured");

    params.push({
      name: "isFeatured",
      type: sql.Bit,
      value: isFeatured,
    });
  }

  // Ví dụ:
  // typeIds = [1, 2]
  // → a.accommodation_type_id IN (@typeId0, @typeId1)
  addCsvFilter({
    whereParts,
    params,
    column: "a.accommodation_type_id",
    values: typeIds,
    parameterPrefix: "typeId",
    sqlType: sql.Int,
  });

  // Ví dụ:
  // statusIds = [1, 2]
  // → a.status IN (@status0, @status1)
  addCsvFilter({
    whereParts,
    params,
    column: "a.status",
    values: statusIds,
    parameterPrefix: "status",
    sqlType: sql.TinyInt,
  });

  /*
   * whereParts có thể là:
   *
   * [
   *   "a.deleted_at IS NULL",
   *   "a.location_id = @locationId",
   *   "a.status IN (@status0, @status1)"
   * ]
   *
   * Ta nối lại thành:
   *
   * WHERE a.deleted_at IS NULL
   * AND a.location_id = @locationId
   * AND a.status IN (@status0, @status1)
   */
  const whereSql =
    whereParts.length > 0 ? `WHERE ${whereParts.join("\nAND ")}` : "";

  /*
   * Query này lấy dữ liệu của trang hiện tại.
   *
   * Nó lấy:
   * - Thông tin chính từ accommodations
   * - Tên loại hình từ accommodation_types
   * - Tên điểm đến từ locations
   * - Tên tỉnh từ provinces
   * - Tên phường từ wards
   * - Ảnh cover từ accommodation_images
   * - Số loại phòng
   * - Số tiện nghi
   */

  const selectSql = `
        SELECT 
        -- Thông tin chính của Accommodation.
        a.id, a.accommodation_code, a.accommodation_name, a.slug,

        -- Thông tin loại hình lưu trú.
        a.accommodation_type_id, t.code AS type_code, t.name AS type_name,

        -- Thông tin điểm đến.
            a.location_id, l.name AS location_name,
        
        -- Thông tin tỉnh/thành.
            a.province_id, p.name AS province_name,
        
        -- Thông tin phường/xã.
            a.ward_id, w.name AS ward_name,

        -- Các thông tin hiển thị trong danh sách.
            a.address_line, a.star_rating, a.status, a.is_featured, a.updated_at,
        
            /*
             * Lấy một ảnh đại diện.
             *
             * Ưu tiên:
             * 1. Ảnh có is_cover = 1
             * 2. sort_order nhỏ hơn
             * 3. id nhỏ hơn
             *
             * OUTER APPLY giúp mỗi accommodation
             * chỉ xuất hiện một dòng.
             */
        cover.image_url AS cover_image_url,

            /*
             * Đếm số loại phòng của accommodation.
             *
             * deleted_at IS NULL nghĩa là không đếm
             * loại phòng đã bị xóa mềm.
             */
            (
                SELECT COUNT(*)
                FROM dbo.room_types rt
                WHERE rt.accommodation_id = a.id
                  AND rt.deleted_at IS NULL
            ) AS room_types_count,

            /*
             * Đếm số tiện nghi được gán cho accommodation.
             */
            (
                SELECT COUNT(*)
                FROM dbo.accommodation_amenities aa
                WHERE aa.accommodation_id = a.id
            ) AS amenities_count

        FROM dbo.accommodations a JOIN dbo.accommodation_types t ON t.id = a.accommodation_type_id
        JOIN dbo.locations l ON l.id = a.location_id
        JOIN dbo.provinces p ON p.id = a.province_id
        LEFT JOIN dbo.wards w ON w.id = a.ward_id

        /*
         * Lấy ảnh đầu tiên phù hợp với từng accommodation.
         */
        OUTER APPLY (
            SELECT TOP 1 ai.image_url
            FROM dbo.accommodation_images ai
            WHERE ai.accommodation_id = a.id
            ORDER BY
                ai.is_cover DESC,
                ai.sort_order ASC,
                ai.id ASC
        ) cover ${whereSql}

        /*
         * whereSql được tạo từ các filter ở bước trước.
         *
         * Ví dụ:
         * WHERE a.deleted_at IS NULL
         * AND a.status IN (@status0)
         * AND a.location_id = @locationId
         */

        /*
         * sortColumn và sortDirection đã được whitelist
         * trước đó, không lấy trực tiếp từ input người dùng.
         *
         * a.id ASC là điều kiện phụ để thứ tự ổn định
         * khi hai dòng có cùng sort_order.
         */

        ORDER BY ${sortColumn} ${sortDirection}${tieBreaker}

        /*
         * Bỏ qua offset dòng đầu tiên,
         * sau đó lấy tối đa limit dòng.
         */

        OFFSET @offset ROWS

        FETCH NEXT @limit ROWS ONLY;
    `;

  /*
   * Query này không lấy dữ liệu chi tiết.
   * Nó chỉ đếm tổng số accommodation phù hợp với filter.
   *
   * Vì sao cần query riêng?
   *
   * Nếu chỉ dùng items.length thì khi đang ở page 2,
   * ta chỉ biết page đó có bao nhiêu dòng,
   * không biết toàn bộ database có bao nhiêu dòng.
   */
  const countSql = `
        SELECT COUNT(*) AS total
        FROM dbo.accommodations a

        ${whereSql};
    `;

  /*
   * Tạo request dùng cho query SELECT.
   *
   * params chứa các parameter đã được tạo từ filter:
   * - q
   * - locationId
   * - provinceId
   * - isFeatured
   * - typeId0, typeId1...
   * - status0, status1...
   */
  const dataRequest = pool.request();

  /*
   * Gắn từng parameter vào request.
   *
   * Ví dụ:
   * .input("locationId", sql.Int, 1)
   *
   * Giá trị không được nối trực tiếp vào SQL.
   * Đây là cách chống SQL injection.
   */
  for (const param of params) {
    dataRequest.input(param.name, param.type, param.value);
  }

  /*
   * offset và limit cũng là parameter SQL.
   */
  dataRequest.input("offset", sql.Int, offset).input("limit", sql.Int, limit);

  /*
   * Query count cũng cần nhận cùng các filter.
   *
   * Ta phải tạo request riêng vì mỗi request
   * có danh sách parameter riêng.
   */
  const countRequest = pool.request();

  for (const param of params) {
    countRequest.input(param.name, param.type, param.value);
  }

  /*
   * Hai query không phụ thuộc kết quả của nhau,
   * nên chạy song song bằng Promise.all().
   *
   * - dataResult: dữ liệu của trang hiện tại
   * - countResult: tổng số dòng phù hợp
   */
  const [dataResult, countResult] = await Promise.all([
    dataRequest.query(selectSql),
    countRequest.query(countSql),
  ]);

  /*
   * dataResult.recordset là mảng các dòng SQL.
   *
   * mapSummaryRow() sẽ chuyển từng dòng:
   * accommodation_name → name
   * is_featured → isFeatured
   * type_code + type_name → type
   */
  const items = dataResult.recordset.map(mapSummaryRow);

  /*
   * COUNT(*) có thể trả về kiểu số khác nhau
   * tùy driver, nên ép rõ về Number.
   */
  const total = Number(countResult.recordset[0]?.total || 0);

  /*
   * Service chỉ trả dữ liệu.
   * Service không gọi res.json().
   *
   * Controller mới chịu trách nhiệm trả HTTP response.
   */
  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}

function mapDetailRow(row) {
  return {
    id: row.id,
    code: row.accommodation_code,
    name: row.accommodation_name,
    slug: row.slug,
    type: {
      id: row.accommodation_type_id,
      code: row.type_code,
      name: row.type_name,
    },

    location: {
      id: row.location_id,
      name: row.location_name,
    },

    province: {
      id: row.province_id,
      name: row.province_name,
    },

    ward: row.ward_id
      ? {
          id: row.ward_id,
          name: row.ward_name,
        }
      : null,

    addressLine: row.address_line,
    starRating: row.star_rating,
    status: row.status,
    statusLabel: ACCOMMODATION_STATUS_LABEL[row.status] || null,
    isFeatured: Boolean(row.is_featured),
    coverImageUrl: row.cover_image_url || null,

    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    directions: row.directions,
    shortDescription: row.short_description,
    description: row.description,
    phone: row.phone,
    email: row.email,
    websiteUrl: row.website_url,

    checkInTime: formatTime(row.check_in_time),
    checkOutTime: formatTime(row.check_out_time),
    checkInInstructions: row.check_in_instructions,
    houseRules: row.house_rules,
    childrenPolicy: row.children_policy,
    petPolicy: row.pet_policy,
    smokingPolicy: row.smoking_policy,

    sortOrder: row.sort_order,
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
  };
}

/**
 * Chuyển một dòng ảnh từ database
 * thành DTO dùng cho frontend.
 *
 * SQL dùng snake_case:
 * image_url, alt_text, is_cover
 *
 * API dùng camelCase:
 * imageUrl, altText, isCover
 */

function mapImageRow(row) {
  return {
    id: row.id,
    imageUrl: row.image_url,
    altText: row.alt_text,
    caption: row.caption,

    // SQL Server trả BIT.
    // Boolean() giúp frontend luôn nhận true hoặc false.
    isCover: Boolean(row.is_cover),

    sortOrder: row.sort_order,
  };
}

/**
 * Chuyển một dòng tiện nghi từ database
 * thành object camelCase cho frontend.
 *
 * SQL trả về các alias dạng snake_case:
 * amenity_id, category_code, is_chargeable
 *
 * API trả về các field dạng camelCase:
 * id, categoryCode, isChargeable
 */

function mapAmenityRow(row) {
  return {
    id: row.amenity_id,
    code: row.amenity_code,
    name: row.amenity_name,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    iconKey: row.icon_key,
    isChargeable: Boolean(row.is_chargeable),
    note: row.note,
  };
}

/**
 * Chuyển số mét thành chuỗi dễ đọc.
 *
 * - null → null vì chưa có khoảng cách
 * - dưới 1000m → hiển thị theo mét
 * - từ 1000m trở lên → hiển thị theo kilomet
 */

function formatDistanceText(distanceMeters) {
  if (distanceMeters === null) {
    return null;
  }

  if (distanceMeters < 1000) {
    return `${distanceMeters} m`;
  }

  const kilometers = distanceMeters / 1000;
  return `${kilometers.toFixed(1)} km`;
}

/**
 * Chuyển một dòng điểm tham quan từ database
 * thành DTO camelCase cho frontend.
 */

function mapAttractionRow(row) {
  const distanceMeters =
    row.distance_meters === null ? null : Number(row.distance_meters);
  return {
    attractionId: row.attraction_id,
    name: row.attraction_name,
    addressLine: row.address_line,
    imageUrl: row.image_url,
    isActive: Boolean(row.is_active),

    distanceMeters,

    // Frontend có thể hiển thị trực tiếp chuỗi này.
    // Ví dụ: 3500 mét → "3.5 km".
    distanceText: formatDistanceText(distanceMeters),

    note: row.note,
    sortOrder: row.sort_order,
  };
}

/**
 * Chuyển một dòng room type từ database
 * thành DTO dùng cho frontend.
 */

function mapRoomTypeRow(row) {
  return {
    id: row.room_type_id,
    code: row.room_type_code,
    name: row.room_type_name,
    status: row.room_type_status,
    statusLabel: ACCOMMODATION_STATUS_LABEL[row.room_type_status] || null,
    quantity: row.quantity,
    bedDescription: row.bed_description,
    bedroomCount: row.bedroom_count,
    areaSqm: row.area_sqm === null ? null : Number(row.area_sqm),
    includedAdults: row.included_adults,
    includedChildren: row.included_children,
    maxOccupancy: row.max_occupancy,

    // MIN(price) có thể không có nếu room type
    // chưa được tạo giá theo các ngày trong tuần.
    minPrice: row.min_price === null ? null : Number(row.min_price),

    coverImageUrl: row.cover_image_url || null,
  };
}

/**
 * Lấy thông tin chính của một cơ sở lưu trú.
 *
 * Giai đoạn này chỉ lấy bảng chính và các bảng quan hệ:
 * - accommodations
 * - accommodation_types
 * - locations
 * - provinces
 * - wards
 *
 * Ảnh gallery, tiện nghi, điểm tham quan và loại phòng
 * sẽ được thêm ở các bước học tiếp theo.
 */
async function getAccommodationDetail(id, currentUser = {}) {
  // Kiểm tra id trước khi gửi xuống database.
  // Ví dụ: "abc", 0, -1 đều không phải ID hợp lệ.
  const accommodationId = parsePositiveInt(id);
  if (!accommodationId) {
    throw new AccommodationServiceError(
      "ID cơ sở lưu trú không hợp lệ.",
      400,
      "VALIDATION_ERROR",
      { id: "ID phải là số nguyên dương." },
    );
  }

  const pool = getDBPool();
  const result = await pool
    .request()
    .input("accommodationId", sql.Int, accommodationId).query(`
        SELECT
                -- Thông tin chính của accommodation.
                a.id,
                a.accommodation_code,
                a.accommodation_name,
                a.slug,
                -- Thông tin loại hình.
                a.accommodation_type_id,
                t.code AS type_code,
                t.name AS type_name,
                -- Thông tin điểm đến.
                a.location_id,
                l.name AS location_name,
                -- Thông tin tỉnh/thành.
                a.province_id,
                p.name AS province_name,
                -- Thông tin phường/xã.
                a.ward_id,
                w.name AS ward_name,
                -- Thông tin hiển thị.
                a.address_line,
                a.star_rating,
                a.status,
                a.is_featured,
                -- Thông tin chi tiết.
                a.postal_code,
                a.latitude,
                a.longitude,
                a.directions,
                a.short_description,
                a.description,
                a.phone,
                a.email,
                a.website_url,
                -- Giờ và chính sách.
                a.check_in_time,
                a.check_out_time,
                a.check_in_instructions,
                a.house_rules,
                a.children_policy,
                a.pet_policy,
                a.smoking_policy,
                -- Thứ tự và thời gian.
                a.sort_order,
                a.created_at,
                a.updated_at,
                /*
                 * Lấy một ảnh đại diện.
                 *
                 * Ưu tiên:
                 * 1. Ảnh có is_cover = 1.
                 * 2. Nếu cùng loại thì lấy sort_order nhỏ hơn.
                 * 3. Nếu vẫn trùng thì lấy id nhỏ hơn.
                 *
                 * OUTER APPLY giúp mỗi accommodation
                 * chỉ xuất hiện một dòng.
                 */
                cover.image_url AS cover_image_url
            FROM dbo.accommodations a
            JOIN dbo.accommodation_types t
                ON t.id = a.accommodation_type_id
            JOIN dbo.locations l
                ON l.id = a.location_id
            JOIN dbo.provinces p
                ON p.id = a.province_id
            LEFT JOIN dbo.wards w
                ON w.id = a.ward_id
            OUTER APPLY (
                SELECT TOP 1
                    ai.image_url
                FROM dbo.accommodation_images ai
                WHERE ai.accommodation_id = a.id
                ORDER BY
                    ai.is_cover DESC,
                    ai.sort_order ASC,
                    ai.id ASC
            ) cover
            WHERE a.id = @accommodationId
              /*
               * Không cho xem dữ liệu đã bị xóa mềm.
               * Đây là quy tắc chung của module accommodation.
               */
              AND a.deleted_at IS NULL;
        `);
  /*
   * Nếu recordset rỗng nghĩa là không có accommodation
   * hoặc accommodation đã bị xóa mềm.
   */
  if (result.recordset.length == 0) {
    throw new AccommodationServiceError(
      "Không tìm thấy cơ sở lưu trú.",
      404,
      "NOT_FOUND",
    );
  }

  const row = result.recordset[0];

  /**
   * Lấy toàn bộ ảnh của accommodation.
   *
   * Đây là query thứ hai của API detail.
   * Nếu accommodation chưa có ảnh,
   * recordset sẽ là [] và đó là trạng thái hợp lệ.
   */

  const imagesResult = await pool
    .request()
    .input("accommodationId", sql.Int, accommodationId).query(`
        SELECT id, image_url, alt_text, caption, is_cover, sort_order
        FROM dbo.accommodation_images
        WHERE accommodation_id = @accommodationId
        ORDER BY is_cover DESC, sort_order ASC, id ASC
    `);

  const images = imagesResult.recordset.map(mapImageRow);

  /**
   * Lấy các tiện nghi đã gán cho accommodation.
   *
   * Nếu accommodation chưa có tiện nghi,
   * recordset sẽ là [] và đó là trạng thái hợp lệ.
   */

  const amenitiesResult = await pool
    .request()
    .input("accommodationId", sql.Int, accommodationId).query(`
        SELECT
            aa.amenity_id,
            am.code AS amenity_code,
            am.name AS amenity_name,
            am.category_code,
            ac.name AS category_name,
            am.icon_key,
            aa.is_chargeable,
            aa.note
        FROM dbo.accommodation_amenities aa
        JOIN dbo.amenities am
        ON am.id = aa.amenity_id
        LEFT JOIN dbo.amenity_categories ac
        ON ac.code = am.category_code
        WHERE aa.accommodation_id = @accommodationId
        ORDER BY
            ac.sort_order ASC,
            am.sort_order ASC,
            am.id ASC;
    `);

  const amenities = amenitiesResult.recordset.map(mapAmenityRow);

  /**
   * Lấy các điểm tham quan được gán cho accommodation.
   *
   * Nếu chưa có điểm tham quan,
   * recordset sẽ là [] và đây là trạng thái hợp lệ.
   */

  const attractionsResult = await pool
    .request()
    .input("accommodationId", sql.Int, accommodationId).query(`
        SELECT
            aa.attraction_id,
            at.name AS attraction_name,
            at.address_line,
            at.image_url,
            at.is_active,
            aa.distance_meters,
            aa.note,
            aa.sort_order
        FROM dbo.accommodation_attractions aa
        JOIN dbo.attractions at
        ON at.id = aa.attraction_id
        WHERE aa.accommodation_id = @accommodationId
        ORDER BY
            aa.sort_order ASC,
            aa.distance_meters ASC,
            at.name ASC;
    `);

  const attractions = attractionsResult.recordset.map(mapAttractionRow);

  /**
   * Lấy các loại phòng chưa bị xóa mềm.
   *
   * OUTER APPLY lấy một ảnh cover duy nhất,
   * tránh làm nhân số dòng room type.
   *
   * Subquery MIN lấy mức giá thấp nhất trong
   * các giá theo ngày của từng room type.
   */

  const roomTypesResult = await pool
    .request()
    .input("accommodationId", sql.Int, accommodationId).query(`
            SELECT
            rt.id AS room_type_id,
            rt.code AS room_type_code,
            rt.name AS room_type_name,
            rt.status AS room_type_status,
            rt.quantity,
            rt.bed_description,
            rt.bedroom_count,
            rt.area_sqm,
            rt.included_adults,
            rt.included_children,
            rt.max_occupancy,
            rates.min_price,
            cover.image_url AS cover_image_url
            FROM dbo.room_types rt
            OUTER APPLY (
                SELECT
                MIN(r.price) AS min_price
                FROM dbo.room_weekday_rates r
                WHERE r.room_type_id = rt.id
            ) rates
            OUTER APPLY (
                SELECT TOP 1 rti.image_url
                FROM dbo.room_type_images rti
                WHERE rti.room_type_id = rt.id
                ORDER BY
                    rti.is_cover DESC,
                    rti.sort_order ASC,
                    rti.id ASC
            ) cover
            WHERE rt.accommodation_id = @accommodationId
            AND rt.deleted_at IS NULL
            ORDER BY
                rt.sort_order ASC,
                rt.id ASC;
    `);

  const roomTypes = roomTypesResult.recordset.map(mapRoomTypeRow);

  /*
   * mapDetailRow() chỉ chuyển đổi tên cột SQL
   * thành object camelCase cho frontend.
   */
  const detail = mapDetailRow(row);

  // Gắn gallery vào DTO sau khi đã map dữ liệu ảnh.
  // Nếu bảng accommodation_images rỗng,
  // images vẫn là mảng [] đúng contract API.
  detail.images = images;
  detail.amenities = amenities;
  detail.attractions = attractions;
  detail.roomTypes = roomTypes;

  return detail;
}

/**
 * Lấy thống kê các cơ sở chưa bị xóa mềm.
 * ADMIN xem tất cả; manager chỉ xem cơ sở được gán.
 *
 * Đầu vào: currentUser lấy từ req.session.admin.
 * Đầu ra: object chứa các số đếm phục vụ Dashboard.
 */

async function getAccommodationStats(currentUser = {}) {
  const pool = getDBPool();
  const isAdmin = currentUser.role === "ADMIN";

  const result = await pool
    .request()
    .input("isAdmin", sql.Bit, isAdmin)
    .input("userId", sql.UniqueIdentifier, currentUser.id ?? null).query(`
        SELECT
                COUNT(*) AS total,
                COUNT(CASE WHEN a.status = 1 THEN 1 END) AS active,
                COUNT(CASE WHEN a.status = 0 THEN 1 END) AS draft,
                COUNT(CASE WHEN a.status = 2 THEN 1 END) AS inactive,
                COUNT(CASE WHEN a.is_featured = 1 THEN 1 END) AS featured,
                COUNT(cover.has_cover) AS withCoverImage,
                COUNT(
                    CASE WHEN room.has_room IS NULL THEN 1 END
                ) AS withoutRoomTypes
            FROM dbo.accommodations a
            -- Chỉ cần biết có ảnh bìa hay không.
            -- TOP 1 tránh nhân dòng khi một cơ sở có nhiều ảnh.
            OUTER APPLY (
                SELECT TOP 1 1 AS has_cover
                FROM dbo.accommodation_images ai
                WHERE ai.accommodation_id = a.id
                  AND ai.is_cover = 1
            ) cover
            -- Loại phòng đã xóa mềm không được tính.
            OUTER APPLY (
                SELECT TOP 1 1 AS has_room
                FROM dbo.room_types rt
                WHERE rt.accommodation_id = a.id
                  AND rt.deleted_at IS NULL
            ) room
            WHERE a.deleted_at IS NULL
              AND (
                  @isAdmin = 1
                  OR EXISTS (
                      SELECT 1
                      FROM dbo.accommodation_managers manager
                      WHERE manager.accommodation_id = a.id
                        AND manager.user_id = @userId
                  )
              );    
    `);

  const row = result.recordset[0];

  return {
    total: Number(row.total),
    active: Number(row.active),
    draft: Number(row.draft),
    inactive: Number(row.inactive),
    featured: Number(row.featured),
    withCoverImage: Number(row.withCoverImage),
    withoutRoomTypes: Number(row.withoutRoomTypes),
  };
}

/*
 * Export các hàm để controller có thể sử dụng.
 */
module.exports = {
  getAccommodationList,
  getAccommodationDetail,
  getAccommodationStats,
  mapSummaryRow,
  mapDetailRow,
  mapAmenityRow,
  mapAttractionRow,
  mapRoomTypeRow,
  AccommodationServiceError,
};
