/**
 * AnthbotGenie.Global — глобальный сценарий-библиотека для интеграции косилок Anthbot в Sprut.Hub.
 *
 * Содержит только чистые функции: криптографию, подпись AWS SigV4 и клиент облака Anthbot.
 * Всё, что трогает устройства и таймеры, живёт в логическом сценарии AnthbotGenie.Logic.js —
 * глобальным сценариям хаб запрещает менять характеристики и ставить таймеры на самих себя.
 *
 * В песочнице Sprut.Hub нет крипто-API (Utils умеет только uuid()) и нет доступа к Java-классам,
 * поэтому MD5, SHA-256 и HMAC-SHA256 реализованы здесь на чистом ES5.
 *
 * Все имена с префиксом anthbot — глобальное пространство имён общее для всех сценариев хаба.
 */

// ============================================================================
// Байты, hex, UTF-8
// ============================================================================

/**
 * Кодирует строку в массив байтов UTF-8.
 * @param {string} str
 * @returns {number[]} массив значений 0..255
 */
function anthbotUtf8Bytes(str) {
    var s = String(str);
    var out = [];
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) {
            out.push(c);
        } else if (c < 0x800) {
            out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length &&
                   s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
            var cp = ((c - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00) + 0x10000;
            out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
            i++;
        } else {
            out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
    }
    return out;
}

/**
 * Переводит массив байтов в hex-строку нижним регистром.
 * @param {number[]} bytes
 * @returns {string}
 */
function anthbotBytesToHex(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i] & 0xff;
        hex += (b < 16 ? "0" : "") + b.toString(16);
    }
    return hex;
}

function anthbotRotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function anthbotRotl(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/**
 * Дополняет сообщение по схеме Меркла-Дамгора: 0x80, нули, длина в битах.
 * @param {number[]} bytes исходные байты
 * @param {boolean} littleEndian true для MD5, false для SHA-256
 * @returns {number[]}
 */
function anthbotPadMessage(bytes, littleEndian) {
    var msg = bytes.slice(0);
    var len = bytes.length;
    msg.push(0x80);
    while (msg.length % 64 !== 56) {
        msg.push(0);
    }
    // Длина в битах как 64-битное число. Через деление, а не сдвиги: сдвиг сломается на 512 МБ,
    // и хотя таких сообщений здесь не будет, дешевле сделать правильно сразу.
    var bitsLo = (len * 8) % 4294967296;
    var bitsHi = Math.floor(len / 536870912);
    if (littleEndian) {
        msg.push(bitsLo & 0xff, (bitsLo >>> 8) & 0xff, (bitsLo >>> 16) & 0xff, (bitsLo >>> 24) & 0xff);
        msg.push(bitsHi & 0xff, (bitsHi >>> 8) & 0xff, (bitsHi >>> 16) & 0xff, (bitsHi >>> 24) & 0xff);
    } else {
        msg.push((bitsHi >>> 24) & 0xff, (bitsHi >>> 16) & 0xff, (bitsHi >>> 8) & 0xff, bitsHi & 0xff);
        msg.push((bitsLo >>> 24) & 0xff, (bitsLo >>> 16) & 0xff, (bitsLo >>> 8) & 0xff, bitsLo & 0xff);
    }
    return msg;
}

// ============================================================================
// SHA-256
// ============================================================================

var ANTHBOT_SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

/**
 * SHA-256 над массивом байтов.
 * @param {number[]} bytes
 * @returns {number[]} 32 байта дайджеста
 */
function anthbotSha256Bytes(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var msg = anthbotPadMessage(bytes, false);
    var w = new Array(64);
    var i;

    for (var off = 0; off < msg.length; off += 64) {
        for (i = 0; i < 16; i++) {
            var p = off + i * 4;
            w[i] = ((msg[p] << 24) | (msg[p + 1] << 16) | (msg[p + 2] << 8) | msg[p + 3]) >>> 0;
        }
        for (i = 16; i < 64; i++) {
            var s0 = (anthbotRotr(w[i - 15], 7) ^ anthbotRotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
            var s1 = (anthbotRotr(w[i - 2], 17) ^ anthbotRotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (i = 0; i < 64; i++) {
            var S1 = (anthbotRotr(e, 6) ^ anthbotRotr(e, 11) ^ anthbotRotr(e, 25)) >>> 0;
            var ch = ((e & f) ^ ((~e) & g)) >>> 0;
            var t1 = (hh + S1 + ch + ANTHBOT_SHA256_K[i] + w[i]) >>> 0;
            var S0 = (anthbotRotr(a, 2) ^ anthbotRotr(a, 13) ^ anthbotRotr(a, 22)) >>> 0;
            var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            var t2 = (S0 + maj) >>> 0;
            hh = g; g = f; f = e;
            e = (d + t1) >>> 0;
            d = c; c = b; b = a;
            a = (t1 + t2) >>> 0;
        }

        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
        h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
        h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }

    var out = [];
    for (i = 0; i < 8; i++) {
        out.push((h[i] >>> 24) & 0xff, (h[i] >>> 16) & 0xff, (h[i] >>> 8) & 0xff, h[i] & 0xff);
    }
    return out;
}

/**
 * SHA-256 от строки, результат — hex.
 * @param {string} str
 * @returns {string}
 */
function anthbotSha256Hex(str) {
    return anthbotBytesToHex(anthbotSha256Bytes(anthbotUtf8Bytes(str)));
}

// ============================================================================
// MD5 (нужен только для verification_token облака Anthbot)
// ============================================================================

var ANTHBOT_MD5_K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
    0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
    0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
];

var ANTHBOT_MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

/**
 * MD5 над массивом байтов.
 * @param {number[]} bytes
 * @returns {number[]} 16 байт дайджеста
 */
function anthbotMd5Bytes(bytes) {
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var msg = anthbotPadMessage(bytes, true);
    var m = new Array(16);
    var i;

    for (var off = 0; off < msg.length; off += 64) {
        for (i = 0; i < 16; i++) {
            var p = off + i * 4;
            m[i] = (msg[p] | (msg[p + 1] << 8) | (msg[p + 2] << 16) | (msg[p + 3] << 24)) >>> 0;
        }

        var A = a0, B = b0, C = c0, D = d0;
        for (i = 0; i < 64; i++) {
            var F, g;
            if (i < 16) {
                F = (B & C) | ((~B) & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | ((~D) & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | (~D));
                g = (7 * i) % 16;
            }
            F = ((F >>> 0) + A + ANTHBOT_MD5_K[i] + m[g]) >>> 0;
            A = D;
            D = C;
            C = B;
            B = (B + anthbotRotl(F, ANTHBOT_MD5_S[i])) >>> 0;
        }

        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    var words = [a0, b0, c0, d0];
    var out = [];
    for (i = 0; i < 4; i++) {
        out.push(words[i] & 0xff, (words[i] >>> 8) & 0xff, (words[i] >>> 16) & 0xff, (words[i] >>> 24) & 0xff);
    }
    return out;
}

/**
 * MD5 от строки, результат — hex.
 * @param {string} str
 * @returns {string}
 */
function anthbotMd5Hex(str) {
    return anthbotBytesToHex(anthbotMd5Bytes(anthbotUtf8Bytes(str)));
}

// ============================================================================
// HMAC-SHA256
// ============================================================================

/**
 * HMAC-SHA256 над массивами байтов.
 * @param {number[]} keyBytes
 * @param {number[]} msgBytes
 * @returns {number[]} 32 байта
 */
function anthbotHmacSha256Bytes(keyBytes, msgBytes) {
    var key = keyBytes.slice(0);
    if (key.length > 64) {
        key = anthbotSha256Bytes(key);
    }
    while (key.length < 64) {
        key.push(0);
    }

    var inner = [];
    var outer = [];
    for (var i = 0; i < 64; i++) {
        inner.push(key[i] ^ 0x36);
        outer.push(key[i] ^ 0x5c);
    }

    return anthbotSha256Bytes(outer.concat(anthbotSha256Bytes(inner.concat(msgBytes))));
}

/**
 * HMAC-SHA256 от строковых ключа и сообщения, результат — hex.
 * @param {string} key
 * @param {string} msg
 * @returns {string}
 */
function anthbotHmacSha256Hex(key, msg) {
    return anthbotBytesToHex(anthbotHmacSha256Bytes(anthbotUtf8Bytes(key), anthbotUtf8Bytes(msg)));
}

// ============================================================================
// AWS Signature Version 4
// ============================================================================

// Ключ подписи зависит только от (секрет, дата, регион, сервис) и переиспользуется весь день —
// без кэша каждый опрос стоил бы четырёх лишних HMAC на ES5.
var ANTHBOT_SIGNING_KEY_CACHE = { id: "", key: null };

/**
 * Выводит ключ подписи AWS SigV4.
 * @param {string} secretAccessKey
 * @param {string} dateStamp формат YYYYMMDD
 * @param {string} region
 * @param {string} service
 * @returns {number[]}
 */
function anthbotSigningKey(secretAccessKey, dateStamp, region, service) {
    // В идентификаторе кэша — отпечаток секрета, а не сам секрет.
    var id = dateStamp + "|" + region + "|" + service + "|" +
             anthbotSha256Hex(secretAccessKey).substring(0, 16);
    if (ANTHBOT_SIGNING_KEY_CACHE.id === id && ANTHBOT_SIGNING_KEY_CACHE.key) {
        return ANTHBOT_SIGNING_KEY_CACHE.key;
    }

    var kDate = anthbotHmacSha256Bytes(anthbotUtf8Bytes("AWS4" + secretAccessKey), anthbotUtf8Bytes(dateStamp));
    var kRegion = anthbotHmacSha256Bytes(kDate, anthbotUtf8Bytes(region));
    var kService = anthbotHmacSha256Bytes(kRegion, anthbotUtf8Bytes(service));
    var kSigning = anthbotHmacSha256Bytes(kService, anthbotUtf8Bytes("aws4_request"));

    ANTHBOT_SIGNING_KEY_CACHE.id = id;
    ANTHBOT_SIGNING_KEY_CACHE.key = kSigning;
    return kSigning;
}

/**
 * Кодирует строку по правилам AWS (unreserved остаются, остальное — %XX в верхнем регистре).
 * @param {string} str
 * @param {boolean} encodeSlash кодировать ли '/' (для path — нет, для значений — да)
 * @returns {string}
 */
function anthbotUriEncode(str, encodeSlash) {
    var bytes = anthbotUtf8Bytes(str);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i];
        var unreserved = (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) ||
                         (b >= 0x61 && b <= 0x7a) ||
                         b === 0x2d || b === 0x2e || b === 0x5f || b === 0x7e;
        if (unreserved) {
            out += String.fromCharCode(b);
        } else if (b === 0x2f && !encodeSlash) {
            out += "/";
        } else {
            out += "%" + ("0" + b.toString(16).toUpperCase()).slice(-2);
        }
    }
    return out;
}

/**
 * Нормализует значение заголовка для канонического запроса: тримминг и схлопывание пробелов.
 * @param {*} value
 * @returns {string}
 */
function anthbotNormalizeHeaderValue(value) {
    return String(value).replace(/\s+/g, " ").replace(/^ /, "").replace(/ $/, "");
}

/**
 * Текущее время в формате AWS: YYYYMMDDTHHMMSSZ (UTC).
 * @param {number} [dateMs] отметка времени; по умолчанию — сейчас
 * @returns {string}
 */
function anthbotAmzDate(dateMs) {
    var d = (dateMs === undefined || dateMs === null) ? new Date() : new Date(dateMs);
    function p2(n) {
        return (n < 10 ? "0" : "") + n;
    }
    return "" + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + "T" +
           p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + "Z";
}

/**
 * Считает заголовок Authorization для AWS SigV4.
 *
 * @param {Object} req описание запроса:
 *   method — GET/POST,
 *   canonicalUri — путь, уже закодированный по правилам AWS,
 *   canonicalQuery — строка запроса, параметры отсортированы,
 *   headers — объект «имя → значение», подписываются ВСЕ переданные,
 *   payloadHash — hex SHA-256 тела,
 *   amzDate — YYYYMMDDTHHMMSSZ,
 *   region, service, accessKeyId, secretAccessKey
 * @returns {Object} { authorization, signature, signedHeaders, canonicalRequest, stringToSign }
 */
function anthbotSigV4Authorization(req) {
    var lowered = {};
    var names = [];
    for (var rawName in req.headers) {
        if (req.headers.hasOwnProperty(rawName)) {
            var name = String(rawName).toLowerCase();
            lowered[name] = anthbotNormalizeHeaderValue(req.headers[rawName]);
            names.push(name);
        }
    }
    names.sort();

    var canonicalHeaders = "";
    var signedHeaders = "";
    for (var i = 0; i < names.length; i++) {
        canonicalHeaders += names[i] + ":" + lowered[names[i]] + "\n";
        signedHeaders += (i > 0 ? ";" : "") + names[i];
    }

    var canonicalRequest = req.method + "\n" +
        req.canonicalUri + "\n" +
        (req.canonicalQuery || "") + "\n" +
        canonicalHeaders + "\n" +
        signedHeaders + "\n" +
        req.payloadHash;

    var dateStamp = req.amzDate.substring(0, 8);
    var scope = dateStamp + "/" + req.region + "/" + req.service + "/aws4_request";
    var stringToSign = "AWS4-HMAC-SHA256\n" +
        req.amzDate + "\n" +
        scope + "\n" +
        anthbotSha256Hex(canonicalRequest);

    var key = anthbotSigningKey(req.secretAccessKey, dateStamp, req.region, req.service);
    var signature = anthbotBytesToHex(anthbotHmacSha256Bytes(key, anthbotUtf8Bytes(stringToSign)));

    return {
        authorization: "AWS4-HMAC-SHA256 Credential=" + req.accessKeyId + "/" + scope +
                       ", SignedHeaders=" + signedHeaders + ", Signature=" + signature,
        signature: signature,
        signedHeaders: signedHeaders,
        canonicalRequest: canonicalRequest,
        stringToSign: stringToSign
    };
}

/**
 * Собирает полный набор заголовков для подписанного запроса к AWS IoT Data.
 *
 * Content-Length сознательно НЕ подписывается: хабовый HttpClient проставляет его сам,
 * и подписать значение, которое мы не контролируем, — верный способ получить 403.
 *
 * @param {Object} req { method, host, path, query, body, region, service }
 * @param {Object} creds { accessKeyId, secretAccessKey, sessionToken }
 * @param {number} [nowMs] отметка времени для подписи
 * @returns {Object} объект «имя заголовка → значение», готовый к отправке
 */
function anthbotSignedHeaders(req, creds, nowMs) {
    var amzDate = anthbotAmzDate(nowMs);
    var body = req.body || "";
    var payloadHash = anthbotSha256Hex(body);

    var toSign = {
        "host": req.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate
    };
    if (body !== "") {
        toSign["content-type"] = req.contentType || "application/octet-stream";
    }
    if (creds.sessionToken) {
        toSign["x-amz-security-token"] = creds.sessionToken;
    }

    var signed = anthbotSigV4Authorization({
        method: req.method,
        canonicalUri: req.canonicalUri || anthbotUriEncode(req.path, false),
        canonicalQuery: req.query || "",
        headers: toSign,
        payloadHash: payloadHash,
        amzDate: amzDate,
        region: req.region,
        service: req.service || "iotdata",
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey
    });

    var headers = {};
    for (var name in toSign) {
        if (toSign.hasOwnProperty(name)) {
            headers[name] = toSign[name];
        }
    }
    headers["Authorization"] = signed.authorization;
    headers["Accept"] = "*/*";
    return headers;
}

/**
 * Строит verification_token, которого ждут файловые и STS-эндпоинты Anthbot:
 * md5(sn + unixTs) в нижнем регистре, к которому приклеен сам unixTs.
 * @param {string} serialNumber
 * @param {number} [unixTs] секунды; по умолчанию — сейчас
 * @returns {string}
 */
function anthbotVerificationToken(serialNumber, unixTs) {
    var ts = (unixTs === undefined || unixTs === null)
        ? Math.floor(new Date().getTime() / 1000)
        : Math.floor(unixTs);
    return anthbotMd5Hex(String(serialNumber) + String(ts)) + String(ts);
}

// ============================================================================
// HTTP: общие помощники
// ============================================================================

var ANTHBOT_API_HOST = "api.anthbot.com";
var ANTHBOT_APP_USER_AGENT = "LdMower/1581 CFNetwork/3860.400.51 Darwin/25.3.0";
var ANTHBOT_CONNECT_TIMEOUT_MS = 10000;
var ANTHBOT_READ_TIMEOUT_MS = 20000;
var ANTHBOT_DEFAULT_IOT_REGION = "us-east-1";
var ANTHBOT_DEFAULT_IOT_ENDPOINT = "a2bhy9nr7jkgaj-ats.iot.us-east-1.amazonaws.com";

/**
 * Результат-неудача в едином формате. Функции клиента ничего не бросают:
 * опрос идёт по таймеру, и разбирать исключения в каждой точке дороже, чем читать поле ok.
 * @param {string} error
 * @param {number} [status]
 * @returns {Object}
 */
function anthbotFail(error, status) {
    return { ok: false, error: String(error), status: status || 0 };
}

/**
 * Отправляет подготовленный запрос и возвращает статус с телом.
 * @param {Object} request HttpRequest хаба
 * @returns {Object} { ok, status, body } либо { ok:false, error }
 */
function anthbotHttpSend(request) {
    try {
        var response = request.timeout(ANTHBOT_CONNECT_TIMEOUT_MS, ANTHBOT_READ_TIMEOUT_MS).send();
        return { ok: true, status: Number(response.getStatus()), body: String(response.getBody()) };
    } catch (e) {
        return anthbotFail("сетевая ошибка: " + e);
    }
}

/**
 * Разбирает JSON, не роняя сценарий на мусорном ответе.
 * @param {string} text
 * @returns {Object} { ok, value } либо { ok:false, error }
 */
function anthbotParseJson(text) {
    try {
        return { ok: true, value: JSON.parse(String(text)) };
    } catch (e) {
        return anthbotFail("ответ не является JSON: " + String(text).substring(0, 200));
    }
}

// ============================================================================
// Облачный API Anthbot (api.anthbot.com)
// ============================================================================

/**
 * Выполняет запрос к облаку Anthbot и разбирает конверт { code, data }.
 *
 * Строка запроса собирается прямо в URL, а не через queryString(): подпись SigV4 и разбор
 * ответов должны видеть ровно то, что уйдёт в сеть, без самодеятельности HTTP-клиента.
 *
 * @param {string} method GET или POST
 * @param {string} path путь, начиная со слэша
 * @param {Object} opts { token, query, jsonBody, host }
 * @returns {Object} { ok, data } либо { ok:false, error, status }
 */
function anthbotCloudRequest(method, path, opts) {
    var options = opts || {};
    var host = options.host || ANTHBOT_API_HOST;
    var url = "https://" + host + path + (options.query ? "?" + options.query : "");
    var request = (method === "POST") ? HttpClient.POST(url) : HttpClient.GET(url);

    request.header("Accept", "application/json, text/plain, */*");
    request.header("version", "v2");
    request.header("language", "en");
    request.header("User-Agent", ANTHBOT_APP_USER_AGENT);
    if (options.token) {
        request.header("Authorization", options.token);
    }
    if (options.jsonBody) {
        request.header("content-type", "application/json");
        request.body(JSON.stringify(options.jsonBody));
    }

    var sent = anthbotHttpSend(request);
    if (!sent.ok) {
        return sent;
    }
    if (sent.status !== 200) {
        return anthbotFail(method + " " + path + " вернул HTTP " + sent.status + ": " +
                           sent.body.substring(0, 200), sent.status);
    }

    var parsed = anthbotParseJson(sent.body);
    if (!parsed.ok) {
        return parsed;
    }
    var payload = parsed.value;
    if (!payload || typeof payload !== "object") {
        return anthbotFail(method + " " + path + ": неожиданный формат ответа");
    }
    if (payload.code !== 0) {
        return anthbotFail(method + " " + path + " отклонён облаком: code=" + payload.code +
                           (payload.msg ? " (" + payload.msg + ")" : ""), sent.status);
    }
    return { ok: true, status: sent.status, data: payload.data };
}

/**
 * Логин в облако Anthbot.
 * @param {string} username
 * @param {string} password
 * @param {string} areaCode телефонный код страны без плюса, например "7" или "49"
 * @returns {Object} { ok, token } — token уже в форме "Bearer …"
 */
function anthbotLogin(username, password, areaCode) {
    var result = anthbotCloudRequest("POST", "/api/v1/login", {
        jsonBody: { username: String(username), password: String(password), areaCode: String(areaCode) }
    });
    if (!result.ok) {
        return result;
    }
    var data = result.data;
    if (!data || !data.access_token) {
        return anthbotFail("в ответе логина нет access_token");
    }
    return { ok: true, token: "Bearer " + data.access_token };
}

/**
 * Список привязанных к аккаунту косилок.
 * @param {string} token
 * @returns {Object} { ok, devices: [{ sn, alias, model, isOwner }] }
 */
function anthbotBindList(token) {
    var result = anthbotCloudRequest("GET", "/api/v1/device/bind/list", { token: token });
    if (!result.ok) {
        return result;
    }
    if (!result.data || typeof result.data.length !== "number") {
        return anthbotFail("список устройств пуст или не является массивом");
    }

    var devices = [];
    for (var i = 0; i < result.data.length; i++) {
        var item = result.data[i];
        if (!item || !item.sn) {
            continue;
        }
        devices.push({
            sn: String(item.sn),
            alias: item.alias ? String(item.alias) : String(item.sn),
            model: (item.category_id === undefined || item.category_id === null)
                ? "" : String(item.category_id),
            isOwner: item.is_owner === true || item.is_owner === 1
        });
    }
    return { ok: true, devices: devices };
}

/**
 * Приводит IoT endpoint к чистому хосту: без схемы и хвостового слэша.
 * @param {string} endpoint
 * @returns {string}
 */
function anthbotNormalizeEndpoint(endpoint) {
    if (!endpoint) {
        return ANTHBOT_DEFAULT_IOT_ENDPOINT;
    }
    var host = String(endpoint).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return host || ANTHBOT_DEFAULT_IOT_ENDPOINT;
}

/**
 * Вытаскивает регион из хоста вида xxx-ats.iot.<region>.amazonaws.com.
 * Регион из хоста важнее региона из API: подпись проверяет тот сервис, к которому мы реально идём.
 * @param {string} endpoint
 * @returns {string} регион либо пустая строка
 */
function anthbotRegionFromEndpoint(endpoint) {
    var host = anthbotNormalizeEndpoint(endpoint);
    var marker = host.indexOf(".iot.");
    if (marker < 0) {
        return "";
    }
    var rest = host.substring(marker + 5);
    var dot = rest.indexOf(".");
    return dot < 0 ? rest : rest.substring(0, dot);
}

/**
 * Регион и IoT endpoint конкретной косилки.
 * @param {string} token
 * @param {string} serialNumber
 * @returns {Object} { ok, regionName, iotEndpoint }
 */
function anthbotDeviceRegion(token, serialNumber) {
    var result = anthbotCloudRequest("GET", "/api/v1/device/v2/region", {
        token: token,
        query: "sn=" + anthbotUriEncode(serialNumber, true)
    });
    if (!result.ok) {
        return result;
    }
    var data = result.data;
    if (!data || !data.iot_endpoint) {
        return anthbotFail("в ответе региона нет iot_endpoint");
    }
    var endpoint = anthbotNormalizeEndpoint(data.iot_endpoint);
    return {
        ok: true,
        regionName: anthbotRegionFromEndpoint(endpoint) ||
                    (data.region_name ? String(data.region_name) : ANTHBOT_DEFAULT_IOT_REGION),
        iotEndpoint: endpoint
    };
}

/**
 * Временные AWS-креды для доступа к shadow конкретной косилки.
 * @param {string} token
 * @param {string} serialNumber
 * @returns {Object} { ok, creds:{accessKeyId,secretAccessKey,sessionToken}, region, endpoint, expiresInSec }
 */
function anthbotIotCredentials(token, serialNumber) {
    var result = anthbotCloudRequest("POST", "/api/v1/device/v2/iot/sts/arn", {
        token: token,
        jsonBody: {
            sn: String(serialNumber),
            verification_token: anthbotVerificationToken(serialNumber)
        }
    });
    if (!result.ok) {
        return result;
    }

    var data = result.data;
    if (!data || !data.access_key_id || !data.secret_access_key || !data.session_token) {
        return anthbotFail("в ответе STS нет временных ключей");
    }
    var endpoint = anthbotNormalizeEndpoint(data.endpoint);
    return {
        ok: true,
        creds: {
            accessKeyId: String(data.access_key_id),
            secretAccessKey: String(data.secret_access_key),
            sessionToken: String(data.session_token)
        },
        region: anthbotRegionFromEndpoint(endpoint) ||
                (data.region_name ? String(data.region_name) : ANTHBOT_DEFAULT_IOT_REGION),
        endpoint: endpoint,
        expiresInSec: (typeof data.expiration === "number" && data.expiration > 0) ? data.expiration : 3600
    };
}

/**
 * Файл разметки участка: ручные зоны и авто-зоны.
 * Скачивается по временной ссылке, которую выдаёт облако.
 * @param {string} token
 * @param {string} serialNumber
 * @returns {Object} { ok, area }
 */
function anthbotAreaDefinition(token, serialNumber) {
    var sn = anthbotUriEncode(serialNumber, true);
    var query = "filename=" + anthbotUriEncode("area_" + serialNumber + ".txt", true) +
                "&sn=" + sn +
                "&category=device&sub_category=area" +
                "&verification_token=" + anthbotVerificationToken(serialNumber);

    var result = anthbotCloudRequest("GET", "/api/v1/device/v2/presigned_url", {
        token: token,
        query: query
    });
    if (!result.ok) {
        return result;
    }
    if (!result.data || !result.data.presigned_url) {
        return anthbotFail("в ответе нет presigned_url для файла зон");
    }

    var downloaded = anthbotHttpSend(HttpClient.GET(String(result.data.presigned_url)));
    if (!downloaded.ok) {
        return downloaded;
    }
    if (downloaded.status !== 200) {
        return anthbotFail("файл зон не скачался: HTTP " + downloaded.status, downloaded.status);
    }

    var parsed = anthbotParseJson(downloaded.body);
    if (!parsed.ok) {
        return parsed;
    }
    return { ok: true, area: parsed.value };
}

// ============================================================================
// История завершённых заданий
// ============================================================================

// Страница истории. Размер выбран так, чтобы участок с ежедневным кошением укладывался
// в одну-две страницы за сезон, а ответ не разрастался до сотен килобайт в песочнице хаба.
var ANTHBOT_RECORDS_PAGE_SIZE = 50;

// Предел страниц за один проход. Нужен не ради экономии, а чтобы неверная догадка о признаке
// «страницы кончились» не превратилась в бесконечный опрос облака.
var ANTHBOT_RECORDS_MAX_PAGES = 10;

// Где в конверте может лежать сам список. Порядок — приоритет поиска.
var ANTHBOT_RECORD_LIST_KEYS = ["list", "records", "rows", "items", "content", "data", "areas"];

/**
 * Приводит время задания к миллисекундам — только для упорядочивания записей.
 *
 * Часовой пояс намеренно не выясняется: значение никуда не выводится, по нему лишь
 * выбирается последнее задание. Строку вида «2026-08-23 10:20:00» разбираем сами, а не
 * через Date.parse: в песочнице хаба движок JS свой, и на нестандартном разделителе
 * Date.parse отдаёт NaN.
 *
 * @param {*} value число (секунды или миллисекунды) либо строка даты
 * @returns {number|null}
 */
function anthbotRecordTimeMs(value) {
    if (typeof value === "number" && isFinite(value)) {
        if (value <= 0) {
            return null;
        }
        return value >= 1e12 ? Math.round(value) : Math.round(value * 1000);
    }
    if (typeof value !== "string") {
        return null;
    }
    var text = value.replace(/^\s+|\s+$/g, "");
    if (/^[0-9]+$/.test(text)) {
        return anthbotRecordTimeMs(Number(text));
    }
    var parts = text.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?/);
    if (!parts) {
        return null;
    }
    return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]),
                    Number(parts[4]), Number(parts[5]), Number(parts[6] || 0));
}

/**
 * Длительность задания в секундах.
 *
 * Поля с суффиксом _ms проверяются первыми и делятся на 1000: облако отдаёт длительность
 * то в секундах, то в миллисекундах, и перепутанные единицы дают расхождение в тысячу раз —
 * такую ошибку в минутах на плитке уже не заметишь.
 *
 * @param {Object} row запись истории
 * @returns {number|null}
 */
function anthbotRecordSeconds(row) {
    var millis = anthbotToInt(anthbotFirstDefined(row, [
        "duration_ms", "durationMs", "mow_time_ms", "mowTimeMs"
    ]));
    if (millis !== null) {
        return Math.round(millis / 1000);
    }
    return anthbotToInt(anthbotFirstDefined(row, [
        "mow_time", "mowTime", "mowing_time", "mowingTime", "work_time", "workTime",
        "use_time", "useTime", "duration"
    ]));
}

// Насколько далеко начало задания может отстоять от его окончания. Задание не длится неделю,
// а часовой пояс разложенных полей от пояса finish_time отличается максимум на половину суток —
// поэтому окно широкое, но ошибку в месяц (≈30 суток) оно отсекает.
var ANTHBOT_RECORD_START_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * Время начала задания из разложенных полей.
 *
 * Проверено на живом облаке 24.08.2026: строки `start_time` в записи нет вовсе, начало
 * разложено по `year`, `month`, `date`, `hour`, `min`, `sec` (есть ещё `weekday`, он не нужен).
 * Месяц считается человеческим, 1..12, и эта догадка проверяется временем окончания: разбор,
 * который даёт начало позже конца или раньше него на неделю, отбрасывается вместо того, чтобы
 * показать неверную дату.
 *
 * Постоянный сдвиг часового пояса порядок заданий не меняет — он одинаков во всех записях,
 * а по этому времени записи только упорядочиваются.
 *
 * @param {Object} row
 * @param {number|null} endMs время окончания, если его удалось прочитать
 * @returns {number|null}
 */
function anthbotRecordCompositeStartMs(row, endMs) {
    var year = anthbotToInt(anthbotFirstDefined(row, ["year"]));
    var month = anthbotToInt(anthbotFirstDefined(row, ["month"]));
    var day = anthbotToInt(anthbotFirstDefined(row, ["date", "day"]));
    if (year === null || month === null || day === null) {
        return null;
    }
    if (year < 100) {
        year += 2000;
    }
    var hour = anthbotToInt(anthbotFirstDefined(row, ["hour"])) || 0;
    var minute = anthbotToInt(anthbotFirstDefined(row, ["min", "minute"])) || 0;
    var second = anthbotToInt(anthbotFirstDefined(row, ["sec", "second"])) || 0;

    var startMs = Date.UTC(year, month - 1, day, hour, minute, second);
    if (typeof endMs !== "number") {
        return startMs;
    }
    var delta = endMs - startMs;
    return (delta > -ANTHBOT_RECORD_START_WINDOW_MS && delta < ANTHBOT_RECORD_START_WINDOW_MS)
        ? startMs : null;
}

/**
 * Разбирает одну запись истории в форму, которой пользуется сценарий.
 *
 * Живая форма записи Genie 800 (снято 24.08.2026): `id`, `mow_time` в секундах,
 * `mowing_area` в кв м, `finish_time` строкой, начало — разложенными полями, плюс `sn`,
 * `mow_mode`, `start_cause`, `finish_cause`, `mowing_progress`, `charge_cnt`, `mow_cnt`,
 * `x`, `y`, `angle` и подписанные ссылки `area_url`, `map_url`, `path_url`, `ebridge_url`.
 * Имена из других реализаций оставлены кандидатами: у моделей 600 / M5 / M9 они могут отличаться.
 *
 * @param {Object} row
 * @returns {Object|null} null, если в записи нет ни одного узнаваемого поля
 */
function anthbotParseMowingRecord(row) {
    if (!row || typeof row !== "object") {
        return null;
    }

    var id = anthbotFirstDefined(row, ["record_id", "recordId", "id", "area_id", "areaId"]);
    var endMs = anthbotRecordTimeMs(anthbotFirstDefined(row, [
        "end_time", "endTime", "finish_time", "finishTime", "update_time", "updateTime"
    ]));
    var startMs = anthbotRecordTimeMs(anthbotFirstDefined(row, [
        "start_time", "startTime", "begin_time", "beginTime", "create_time", "createTime"
    ]));
    if (startMs === null) {
        startMs = anthbotRecordCompositeStartMs(row, endMs);
    }
    var seconds = anthbotRecordSeconds(row);
    var area = anthbotToInt(anthbotFirstDefined(row, [
        "mow_area", "mowArea", "mowing_area", "mowingArea", "cover_area", "coverArea", "area"
    ]));

    if (id === undefined && startMs === null && seconds === null && area === null) {
        return null;
    }
    return {
        id: id === undefined ? null : String(id),
        startMs: startMs,
        endMs: endMs,
        seconds: seconds,
        area: area
    };
}

/**
 * Достаёт список записей из конверта, каким бы именем он ни назывался.
 *
 * Пустая история и непонятный ответ различаются намеренно: молча выданный пустой список
 * превратился бы в честные с виду нули на плитке. Поэтому неизвестная форма — это отказ,
 * и в текст отказа попадают имена полей, чтобы владельцу хаба было что прислать.
 *
 * @param {*} data поле data ответа облака
 * @returns {Object} { ok, rows } либо { ok:false, error }
 */
function anthbotRecordRows(data) {
    if (data && typeof data.length === "number" && typeof data !== "string") {
        return { ok: true, rows: data };
    }
    if (!data || typeof data !== "object") {
        return anthbotFail("в ответе истории нет данных");
    }

    for (var i = 0; i < ANTHBOT_RECORD_LIST_KEYS.length; i++) {
        var candidate = data[ANTHBOT_RECORD_LIST_KEYS[i]];
        if (candidate && typeof candidate.length === "number" && typeof candidate !== "string") {
            return { ok: true, rows: candidate };
        }
    }

    var total = anthbotToInt(anthbotFirstDefined(data, ["total", "count", "totalCount", "total_count"]));
    if (total === 0) {
        return { ok: true, rows: [] };
    }

    var keys = [];
    for (var key in data) {
        if (data.hasOwnProperty(key)) {
            keys.push(key);
        }
    }
    return anthbotFail("в ответе истории нет списка заданий; поля ответа: " + keys.join(", "));
}

/**
 * Одна страница истории заданий.
 *
 * Эндпоинт взят из чужой HA-интеграции ha-anthbot-map-v2, где он снят захватом трафика
 * мобильного приложения. Форма ответа на живом облаке не проверялась — отсюда разбор
 * через списки кандидатов и явный отказ на неизвестной форме.
 *
 * @param {string} token
 * @param {string} serialNumber
 * @param {number} [page] номер страницы, с единицы
 * @param {number} [pageSize]
 * @returns {Object} { ok, records, rows, pageSize } либо { ok:false, error, status }
 */
function anthbotMowingRecordsPage(token, serialNumber, page, pageSize) {
    var size = Math.max(1, Math.min(Number(pageSize) || ANTHBOT_RECORDS_PAGE_SIZE, 200));
    var num = Math.max(1, Math.round(Number(page) || 1));

    var result = anthbotCloudRequest("GET", "/api/v1/device/area", {
        token: token,
        query: "sn=" + anthbotUriEncode(serialNumber, true) +
               "&pagenum=" + num + "&pagesize=" + size
    });
    if (!result.ok) {
        return result;
    }

    var rows = anthbotRecordRows(result.data);
    if (!rows.ok) {
        return rows;
    }

    var records = [];
    for (var i = 0; i < rows.rows.length; i++) {
        var record = anthbotParseMowingRecord(rows.rows[i]);
        if (record) {
            records.push(record);
        }
    }
    // Сырая первая запись едет наружу нарочно: форма ответа не проверена на живом облаке,
    // и без неё владельцу хаба нечем ответить на вопрос «как облако назвало поля».
    // Значения в лог не попадают — только имена полей (см. anthbotLoadHistory).
    return {
        ok: true,
        records: records,
        rows: rows.rows.length,
        pageSize: size,
        rawFirst: rows.rows.length > 0 ? rows.rows[0] : null
    };
}

/**
 * Вся доступная история заданий: страницы читаются до короткой либо до предела.
 *
 * @param {string} token
 * @param {string} serialNumber
 * @param {number} [maxPages]
 * @returns {Object} { ok, records, pages, truncated } либо { ok:false, error, status }
 */
function anthbotMowingHistory(token, serialNumber, maxPages) {
    var limit = Math.max(1, Math.round(Number(maxPages) || ANTHBOT_RECORDS_MAX_PAGES));
    var records = [];
    var pages = 0;
    var rawFirst = null;

    for (var page = 1; page <= limit; page++) {
        var result = anthbotMowingRecordsPage(token, serialNumber, page, ANTHBOT_RECORDS_PAGE_SIZE);
        if (!result.ok) {
            // Первая страница не прочиталась — сообщаем отказ. Оборвавшаяся вторая оставляет
            // неполные итоги, которые выглядели бы как «часть заданий пропала», поэтому
            // отказ возвращается и здесь.
            return result;
        }
        pages = page;
        if (rawFirst === null) {
            rawFirst = result.rawFirst;
        }
        for (var i = 0; i < result.records.length; i++) {
            records.push(result.records[i]);
        }
        if (result.rows < result.pageSize) {
            return { ok: true, records: records, pages: pages, truncated: false, rawFirst: rawFirst };
        }
    }
    // Предел страниц исчерпан, а последняя страница была полной: итоги считаются по прочитанному.
    // Молчать об этом нельзя — иначе «наработка всего» тихо окажется наработкой за часть истории.
    return { ok: true, records: records, pages: pages, truncated: true, rawFirst: rawFirst };
}

/**
 * Время, по которому запись сравнима с другими: начало, а без него — окончание.
 * @param {Object|null} record
 * @returns {number|null}
 */
function anthbotRecordWhenMs(record) {
    if (!record) {
        return null;
    }
    if (typeof record.startMs === "number") {
        return record.startMs;
    }
    return typeof record.endMs === "number" ? record.endMs : null;
}

/**
 * Итоги по истории: сколько всего наработано и какое задание последнее.
 *
 * Считается по тем записям, что отдало облако. Косилка Genie 800 наработку за всё время
 * в состоянии не передаёт вовсе, поэтому другого источника для неё нет.
 *
 * @param {Object[]} records
 * @returns {Object} { count, timeSec, areaM2, last }
 */
function anthbotMowingHistoryTotals(records) {
    var list = (records && typeof records.length === "number") ? records : [];
    var timeSec = null;
    var areaM2 = null;
    var last = null;

    for (var i = 0; i < list.length; i++) {
        var record = list[i];
        if (!record) {
            continue;
        }
        if (typeof record.seconds === "number" && record.seconds > 0) {
            timeSec = (timeSec === null ? 0 : timeSec) + record.seconds;
        }
        if (typeof record.area === "number" && record.area > 0) {
            areaM2 = (areaM2 === null ? 0 : areaM2) + record.area;
        }
        // Порядок записей в ответе не обещан, поэтому последнее задание ищется по времени —
        // по началу, а если его нет, то по окончанию. Опираться на порядок нельзя: на живом
        // облаке начало приходит разложенными полями, и разбор, не собиравший его, держался
        // ровно на том, что облако отдало новое задание первым.
        var when = anthbotRecordWhenMs(record);
        var lastWhen = anthbotRecordWhenMs(last);
        if (last === null) {
            last = record;
        } else if (when !== null && (lastWhen === null || when > lastWhen)) {
            last = record;
        }
    }

    return { count: list.length, timeSec: timeSec, areaM2: areaM2, last: last };
}

// ============================================================================
// Плоскость данных AWS IoT: чтение shadow и отправка команд
// ============================================================================

/**
 * Выполняет подписанный запрос к AWS IoT Data.
 *
 * @param {Object} session { endpoint, region, creds }
 * @param {Object} req { method, path, query, body }
 * @returns {Object} { ok, status, body } либо { ok:false, error, status }
 */
function anthbotIotRequest(session, req) {
    var url = "https://" + session.endpoint + req.path + (req.query ? "?" + req.query : "");
    var headers = anthbotSignedHeaders({
        method: req.method,
        host: session.endpoint,
        path: req.path,
        canonicalUri: req.canonicalUri,
        query: req.query || "",
        body: req.body || "",
        region: session.region,
        service: "iotdata"
    }, session.creds);

    var request = (req.method === "POST") ? HttpClient.POST(url) : HttpClient.GET(url);
    for (var name in headers) {
        if (headers.hasOwnProperty(name)) {
            request.header(name, headers[name]);
        }
    }
    if (req.body) {
        request.body(req.body);
    }

    var sent = anthbotHttpSend(request);
    if (!sent.ok) {
        return sent;
    }
    if (sent.status !== 200) {
        return anthbotFail("IoT " + req.method + " " + req.path + " вернул HTTP " + sent.status +
                           ": " + sent.body.substring(0, 200), sent.status);
    }
    return { ok: true, status: sent.status, body: sent.body };
}

/**
 * Читает именованный shadow косилки и возвращает state.reported.
 * @param {Object} session
 * @param {string} shadowName обычно "property" или "service"
 * @returns {Object} { ok, reported }
 */
function anthbotGetShadow(session, shadowName) {
    var result = anthbotIotRequest(session, {
        method: "GET",
        path: "/things/" + session.sn + "/shadow",
        query: "name=" + anthbotUriEncode(shadowName, true)
    });
    if (!result.ok) {
        return result;
    }

    var parsed = anthbotParseJson(result.body);
    if (!parsed.ok) {
        return parsed;
    }
    var state = parsed.value ? parsed.value.state : null;
    if (!state || !state.reported) {
        return anthbotFail("в shadow '" + shadowName + "' нет state.reported");
    }
    return {
        ok: true,
        reported: state.reported,
        updatedAtMs: anthbotShadowUpdatedAtMs(parsed.value ? parsed.value.metadata : null)
    };
}

/**
 * Когда косилка в последний раз что-либо сообщила о себе.
 *
 * AWS IoT кладёт рядом с каждым полем reported отметку времени его последнего изменения —
 * самая свежая из них и есть момент последней связи. Само поле `online` этого не заменяет:
 * облако отвечает 200 и отдаёт последнее известное состояние сколь угодно долго после того,
 * как косилка пропала, и карточка уверенно показывает «косит» у машины, которая уже не косит.
 *
 * Отметки идут в секундах эпохи; разбор общий с историей заданий, он же терпит миллисекунды.
 *
 * @param {Object} metadata поле metadata ответа GetThingShadow
 * @returns {number|null} null, если отметок в ответе нет — тогда о свежести судить нечем
 */
function anthbotShadowUpdatedAtMs(metadata) {
    var reported = metadata ? metadata.reported : null;
    if (!reported || typeof reported !== "object") {
        return null;
    }

    var newest = null;
    // Обход итеративный: у Genie 800 metadata повторяет вложенность reported (param_set,
    // nest_param_set, fw_version), а рекурсия в песочнице хаба дороже и на кривом ответе
    // с петлёй в объекте кончилась бы переполнением стека.
    var queue = [reported];
    var seen = 0;
    while (queue.length > 0 && seen < 5000) {
        var node = queue.pop();
        seen++;
        if (!node || typeof node !== "object") {
            continue;
        }
        for (var key in node) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            var value = node[key];
            if (key === "timestamp") {
                var stamp = anthbotRecordTimeMs(value);
                if (stamp !== null && (newest === null || stamp > newest)) {
                    newest = stamp;
                }
            } else if (value && typeof value === "object") {
                queue.push(value);
            }
        }
    }
    return newest;
}

/**
 * Пишет desired-состояние в именованный shadow (документированный UpdateThingShadow).
 *
 * ВНИМАНИЕ: для Genie 800 этот путь бесполезен — облако отвечает 200, но косилка команду не
 * применяет (проверено на живой машине: громкость не изменилась за 30 секунд). Прошивка слушает
 * сам топик публикации, а не дельту shadow. Оставлено как вариант для других моделей.
 *
 * @param {Object} session
 * @param {string} shadowName
 * @param {Object} desired
 * @returns {Object} { ok }
 */
function anthbotUpdateShadow(session, shadowName, desired) {
    return anthbotIotRequest(session, {
        method: "POST",
        path: "/things/" + session.sn + "/shadow",
        query: "name=" + anthbotUriEncode(shadowName, true),
        body: JSON.stringify({ state: { desired: desired } })
    });
}

/**
 * Публикация MQTT-сообщения через HTTP-эндпоинт /topics — рабочий путь доставки команд.
 *
 * Путь топика содержит `$` и слэши, которые в URL закодированы (`%24aws%2F…`), а SigV4 требует
 * закодировать их в каноническом запросе ещё раз. HTTP-клиенты по-разному нормализуют такой путь,
 * поэтому предусмотрено два варианта подписи; рабочий определяется по факту (на curl и на живом
 * облаке подтверждены оба, по умолчанию идёт нулевой).
 *
 * Вариант 1 (закодированный путь без повторного кодирования в подписи) изъят: он подписывает
 * путь ровно в том виде, в каком шлёт, — это правило S3, а не IoT. Что бы клиент ни сделал с
 * путём, верной оказывается форма варианта 0 (путь ушёл закодированным) либо варианта 2 (клиент
 * его раскодировал), но никогда промежуточная. Живой AWS отвечал на него 403. Нумерация оставлена
 * прежней, чтобы не разошлась с журналом: любое значение, кроме 2, даёт вариант 0.
 *
 * @param {Object} session
 * @param {string} topic
 * @param {Object} payload
 * @param {number} [mode] 0 — закодированный путь с повторным кодированием в подписи (по умолчанию),
 *                        2 — сырой путь топика
 * @returns {Object} { ok }
 */
function anthbotPublishToTopic(session, topic, payload, mode) {
    var encodedPath = "/topics/" + anthbotUriEncode(topic, true);
    var rawPath = "/topics/" + topic;
    var path = encodedPath;
    var canonicalUri = anthbotUriEncode(encodedPath, false);

    if (mode === 2) {
        path = rawPath;
        canonicalUri = anthbotUriEncode(rawPath, false);
    }

    return anthbotIotRequest(session, {
        method: "POST",
        path: path,
        canonicalUri: canonicalUri,
        query: "",
        body: JSON.stringify(payload)
    });
}

/**
 * Отправляет команду косилке.
 *
 * По умолчанию — публикацией в топик: только этот путь Genie 800 действительно исполняет.
 *
 * @param {Object} session
 * @param {string} cmd имя команды, например "mow_start"
 * @param {*} data полезная нагрузка команды
 * @param {Object} [delivery] { viaShadow: true } — писать в shadow вместо топика;
 *                            { topicMode: 0..2 } — вариант подписи пути топика
 * @returns {Object} { ok }
 */
function anthbotSendCommand(session, cmd, data, delivery) {
    var desired = { cmd: String(cmd), data: data };
    var options = delivery || {};

    if (options.viaShadow) {
        return anthbotUpdateShadow(session, "service", desired);
    }
    return anthbotPublishToTopic(session,
        "$aws/things/" + session.sn + "/shadow/name/service/update",
        { state: { desired: desired } },
        options.topicMode || 0);
}

// ============================================================================
// Сессия: логин, выбор устройства, обновление временных кредов
// ============================================================================

/**
 * Доводит сессию до рабочего состояния: токен, серийник, endpoint, свежие временные креды.
 * Состояние передаётся объектом и мутируется на месте — логический сценарий хранит его в variables.
 *
 * @param {Object} state { token, sn, alias, model, endpoint, region, creds, credsExpireAtMs }
 * @param {Object} config { username, password, areaCode, serialNumber }
 * @returns {Object} { ok } либо { ok:false, error }
 */
function anthbotEnsureSession(state, config) {
    if (!state.token) {
        var login = anthbotLogin(config.username, config.password, config.areaCode);
        if (!login.ok) {
            return login;
        }
        state.token = login.token;
        // Смена аккаунта обесценивает всё, что было привязано к прежнему токену.
        state.sn = null;
        state.creds = null;
    }

    if (!state.sn) {
        var list = anthbotBindList(state.token);
        if (!list.ok) {
            return list;
        }
        if (list.devices.length === 0) {
            return anthbotFail("к аккаунту не привязано ни одной косилки");
        }
        var picked = null;
        if (config.serialNumber) {
            for (var i = 0; i < list.devices.length; i++) {
                if (list.devices[i].sn === String(config.serialNumber)) {
                    picked = list.devices[i];
                }
            }
            if (!picked) {
                return anthbotFail("косилка с серийником " + config.serialNumber + " не найдена в аккаунте");
            }
        } else {
            picked = list.devices[0];
        }
        state.sn = picked.sn;
        state.alias = picked.alias;
        state.model = picked.model;
        state.endpoint = null;
    }

    if (!state.endpoint) {
        var region = anthbotDeviceRegion(state.token, state.sn);
        if (!region.ok) {
            return region;
        }
        state.endpoint = region.iotEndpoint;
        state.region = region.regionName;
        state.creds = null;
    }

    var nowMs = new Date().getTime();
    if (!state.creds || !state.credsExpireAtMs || nowMs >= state.credsExpireAtMs) {
        var sts = anthbotIotCredentials(state.token, state.sn);
        if (!sts.ok) {
            return sts;
        }
        state.creds = sts.creds;
        state.endpoint = sts.endpoint || state.endpoint;
        state.region = sts.region || state.region;
        // Обновляемся за 5 минут до истечения, но не чаще раза в минуту.
        state.credsExpireAtMs = nowMs + Math.max(sts.expiresInSec - 300, 60) * 1000;
    }

    return { ok: true };
}

/**
 * Сбрасывает часть сессии в зависимости от кода ошибки, чтобы следующий вызов
 * anthbotEnsureSession переполучил именно то, что протухло.
 * @param {Object} state
 * @param {number} status HTTP-статус неудачного запроса
 * @returns {boolean} есть ли смысл повторять запрос
 */
function anthbotInvalidateSession(state, status) {
    if (status === 401) {
        state.token = null;
        state.creds = null;
        return true;
    }
    if (status === 403) {
        state.creds = null;
        state.credsExpireAtMs = 0;
        return true;
    }
    return false;
}

// ============================================================================
// Разбор state.reported
// ============================================================================

/**
 * Достаёт значение по пути вида "robot_sta.value".
 * @param {Object} obj
 * @param {string} path
 * @returns {*} undefined, если пути нет
 */
function anthbotGetPath(obj, path) {
    var parts = String(path).split(".");
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
        if (current === null || current === undefined || typeof current !== "object") {
            return undefined;
        }
        current = current[parts[i]];
    }
    return current;
}

/**
 * Возвращает первое определённое значение из списка путей.
 *
 * Каждая модель косилки раскладывает одно и то же по-своему (elec против elec.value,
 * robot_sta против mode), поэтому весь разбор идёт через списки кандидатов —
 * добавить путь под новую модель дешевле, чем ветвиться по модели в каждом месте.
 *
 * @param {Object} obj
 * @param {string[]} paths
 * @returns {*}
 */
function anthbotFirstDefined(obj, paths) {
    for (var i = 0; i < paths.length; i++) {
        var value = anthbotGetPath(obj, paths[i]);
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
}

/**
 * Приводит значение к целому числу; null, если это не число.
 * @param {*} value
 * @returns {number|null}
 */
function anthbotToInt(value) {
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "number" && isFinite(value)) {
        return Math.round(value);
    }
    if (typeof value === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
        return Math.round(Number(value));
    }
    if (value && typeof value === "object" && value.value !== undefined) {
        return anthbotToInt(value.value);
    }
    return null;
}

/**
 * Приводит к булеву значению принятые в облаке формы: 1/0, true/false, "on"/"enabled".
 * @param {*} value
 * @returns {boolean}
 */
function anthbotToBool(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value === 1;
    }
    if (typeof value === "string") {
        var lowered = value.toLowerCase();
        return lowered === "1" || lowered === "true" || lowered === "on" ||
               lowered === "enable" || lowered === "enabled";
    }
    if (value && typeof value === "object" && value.value !== undefined) {
        return anthbotToBool(value.value);
    }
    return false;
}

// Числовой код состояния косилки → строковый ключ. Порядок взят из прошивки и совпадает
// с тем, что использует HA-интеграция; строковые значения приходят напрямую.
var ANTHBOT_ROBOT_STATUS_BY_CODE = [
    "idle", "pause", "charge", "sleep", "ota", "position", "globalmowing", "zonemowing",
    "pointmowing", "mapping", "backtodock", "resume_point", "shutdown", "remotectrl",
    "factory", "sleep", "camera_cleaning", "gototarget", "bordermowing", "regionmowing",
    "nestmowing"
];

var ANTHBOT_STATUS_LABELS = {
    idle: "Простаивает",
    pause: "Пауза",
    charge: "На зарядке",
    charging: "На зарядке",
    charge_start: "Едет заряжаться",
    sleep: "Спит",
    ota: "Обновление прошивки",
    position: "Определяет положение",
    globalmowing: "Косит весь газон",
    zonemowing: "Косит зону",
    pointmowing: "Косит участок",
    mapping: "Строит карту",
    backtodock: "Возвращается на базу",
    resume_point: "Возобновляет кошение",
    shutdown: "Выключена",
    remotectrl: "Ручное управление",
    factory: "Заводской режим",
    camera_cleaning: "Чистит камеру",
    gototarget: "Едет к цели",
    bordermowing: "Косит по периметру",
    regionmowing: "Косит авто-зону",
    nestmowing: "Косит у базы"
};

var ANTHBOT_MOWING_STATUSES = "globalmowing zonemowing pointmowing bordermowing regionmowing " +
    "nestmowing position resume_point gototarget mapping";
var ANTHBOT_DOCKED_STATUSES = "charge charging charge_start idle sleep shutdown";

/**
 * Строковый ключ состояния косилки из reported.
 * @param {Object} reported
 * @returns {string} пустая строка, если состояние не распознано
 */
function anthbotRobotStatusKey(reported) {
    var raw = anthbotFirstDefined(reported, [
        "robot_sta.value", "robot_sta", "mode.value", "mode", "work_mode.value", "status.value"
    ]);
    if (typeof raw === "number") {
        return ANTHBOT_ROBOT_STATUS_BY_CODE[raw] || String(raw);
    }
    if (typeof raw === "string") {
        return raw.toLowerCase();
    }
    return "";
}

/**
 * Человекочитаемый статус на русском.
 * @param {string} statusKey
 * @returns {string}
 */
function anthbotStatusText(statusKey) {
    if (!statusKey) {
        return "Состояние неизвестно";
    }
    return ANTHBOT_STATUS_LABELS[statusKey] || statusKey;
}

/**
 * Классифицирует состояние: mowing / returning / paused / docked / unknown.
 * @param {string} statusKey
 * @returns {string}
 */
function anthbotActivity(statusKey) {
    if (!statusKey) {
        return "unknown";
    }
    if (statusKey === "backtodock") {
        return "returning";
    }
    if (statusKey === "pause") {
        return "paused";
    }
    if ((" " + ANTHBOT_MOWING_STATUSES + " ").indexOf(" " + statusKey + " ") >= 0) {
        return "mowing";
    }
    if ((" " + ANTHBOT_DOCKED_STATUSES + " ").indexOf(" " + statusKey + " ") >= 0) {
        return "docked";
    }
    return "unknown";
}

/**
 * Сводит reported к плоскому состоянию, которое логический сценарий раскладывает по характеристикам.
 * Поля, которых нет у конкретной модели, остаются null — их не нужно писать в хаб.
 *
 * @param {Object} reported
 * @returns {Object}
 */
function anthbotMapReported(reported) {
    var data = reported || {};
    var statusKey = anthbotRobotStatusKey(data);
    var activity = anthbotActivity(statusKey);
    var onlineRaw = anthbotFirstDefined(data, ["online", "online.value", "net_config.online"]);

    var nestLevel = anthbotToInt(anthbotFirstDefined(data, [
        "nest_pobctl_level", "nest_pobctl_level.value", "nest_param_set.pobctl_level", "pobctl.level"
    ]));

    return {
        statusKey: statusKey,
        statusText: anthbotStatusText(statusKey),
        activity: activity,
        mowing: activity === "mowing",
        charging: statusKey === "charge" || statusKey === "charging" ||
                  anthbotToBool(anthbotFirstDefined(data, ["charge_sta", "charge_sta.value"])),
        online: onlineRaw === undefined ? null : anthbotToBool(onlineRaw),

        battery: anthbotToInt(anthbotFirstDefined(data, ["elec.value", "elec", "battery.value", "battery", "power.value"])),
        cutterHeight: anthbotToInt(anthbotFirstDefined(data, [
            "param_set.cutter_height", "mow_remote.cutter_height", "cutter_height"
        ])),
        volume: anthbotToInt(anthbotFirstDefined(data, ["volume.value", "volume", "volume_ctl"])),
        mowDirection: anthbotToInt(anthbotFirstDefined(data, ["param_set.mow_head", "mow_head"])),
        // enable_adaptive_head == 1 означает автоподбор направления, то есть СВОЁ направление выключено
        customDirection: !anthbotToBool(anthbotFirstDefined(data, [
            "param_set.enable_adaptive_head", "enable_adaptive_head"
        ])),
        rainEnabled: anthbotToBool(anthbotFirstDefined(data, ["rain_switch", "rain_switch.value"])),
        rainContinueTime: anthbotToInt(anthbotFirstDefined(data, ["rain_continue_time", "rain_continue_time.value"])),

        nestEnabled: anthbotToBool(anthbotFirstDefined(data, [
            "nest_switch", "nest_switch.value", "param_set.nest_switch"
        ])),
        nestMowCount: anthbotToInt(anthbotFirstDefined(data, [
            "nest_mow_count", "nest_mow_count.value", "nest_param_set.mow_count"
        ])),
        nestCutterHeight: anthbotToInt(anthbotFirstDefined(data, [
            "nest_cutter_height", "nest_cutter_height.value", "nest_param_set.cutter_height"
        ])),
        nestInspection: anthbotToBool(anthbotFirstDefined(data, [
            "nest_pobctl_switch", "nest_pobctl_switch.value", "nest_param_set.pobctl_switch", "pobctl.switch"
        ])),
        nestInspectionLevel: nestLevel,

        errorCode: anthbotToInt(anthbotFirstDefined(data, ["error.value", "error", "error_code", "err_code"])),
        rtkState: anthbotFirstDefined(data, ["rtk.state", "rtk.value", "rtk", "rtk_state", "rtk_base.state"]),
        ip: anthbotFirstDefined(data, ["net_config.ip", "ip", "sta_ip_addr"]),
        ssid: anthbotFirstDefined(data, ["net_config.ssid", "ssid", "sta_ssid"]),
        mapArea: anthbotToInt(anthbotFirstDefined(data, ["map.map_area", "map_area"])),
        mapState: anthbotFirstDefined(data, ["map_sta.value", "mapping_task.state", "map_sta"]),
        firmware: anthbotFirstDefined(data, ["fw_version.system_version", "fw_version", "version"]),

        mowingTime: anthbotToInt(anthbotFirstDefined(data, ["mowing_time_new.value", "mowing_time_new"])),
        mowingArea: anthbotToInt(anthbotFirstDefined(data, ["mowing_area_new.value", "mowing_area_new"])),
        mowingTimeTotal: anthbotToInt(anthbotFirstDefined(data, ["mowing_time.value", "mowing_time"])),
        mowingAreaTotal: anthbotToInt(anthbotFirstDefined(data, ["mowing_area.value", "mowing_area"])),

        activeZoneIds: anthbotActiveZoneIds(data),
        regionMowing: anthbotToInt(anthbotFirstDefined(data, ["mow_region", "mow_region.value"])) === 1,
        regionPoint: anthbotActiveRegionPoint(data)
    };
}

/**
 * Точка авто-задания — та, что косилка получила в region_mow_start.
 *
 * Признак «идёт авто-задание» — это mow_region, а НЕ непустой points: как и active_area,
 * поле переживает завершение задания и продолжает показывать точку прошлого. Проверено
 * на живой Genie 800 23.08.2026.
 *
 * @param {Object} reported
 * @returns {number[]|null} [x, y] в миллиметрах карты
 */
function anthbotActiveRegionPoint(reported) {
    var points = anthbotGetPath(reported, "region_area.points");
    if (!points || typeof points.length !== "number" || points.length === 0) {
        return null;
    }
    var point = points[0];
    if (!point || typeof point.length !== "number" || point.length < 2) {
        return null;
    }
    var x = anthbotToInt(point[0]);
    var y = anthbotToInt(point[1]);
    return (x === null || y === null) ? null : [x, y];
}

/**
 * Идентификаторы зон текущего задания — а на базе последнего завершённого.
 *
 * Название поля обманчиво: «active» здесь не «прямо сейчас косится». Проверено на живой
 * Genie 800 (прошивка 1.20.9) 23.08.2026: список не укорачивается по мере готовности зон
 * и переживает завершение задания — полтора часа на базе косилка отдавала прежний состав.
 * Набором зон карты он тоже не является: при шести зонах на карте задание из одной зоны
 * даёт один id. Подробности замера — в записи журнала за 23.08.2026.
 *
 * @param {Object} reported
 * @returns {number[]}
 */
function anthbotActiveZoneIds(reported) {
    var ids = anthbotGetPath(reported, "active_area.id");
    var out = [];
    if (ids && typeof ids.length === "number") {
        for (var i = 0; i < ids.length; i++) {
            var id = anthbotToInt(ids[i]);
            if (id !== null) {
                out.push(id);
            }
        }
    }
    return out;
}

/**
 * Ручные зоны из файла разметки участка.
 * @param {Object} area
 * @returns {Object[]} [{ id, name }]
 */
function anthbotManualZones(area) {
    return anthbotZonesFrom(area, ["custom_areas", "customAreas", "zones"]);
}

/**
 * Авто-зоны (регионы) из файла разметки участка.
 * @param {Object} area
 * @returns {Object[]} [{ id, name, points }]
 */
function anthbotAutoZones(area) {
    return anthbotZonesFrom(area, [
        "region_areas", "regionAreas", "auto_regions", "autoRegions", "auto_zones", "autoZones", "regions"
    ]);
}

// ============================================================================
// Сборка команд
// ============================================================================

var ANTHBOT_RAIN_DEFAULT_CONTINUE_SEC = 10800;

/**
 * Старт кошения: сначала косилку нужно вывести из «приложение не смотрит» состояния,
 * иначе mow_start игнорируется.
 * @returns {Object[]} список команд по порядку
 */
function anthbotCommandsStartMowing() {
    return [{ cmd: "app_state", data: 1 }, { cmd: "mow_start", data: 1 }];
}

/**
 * Остановка. Отдельной команды «пауза» у косилки нет — останавливаются все задачи.
 * @returns {Object[]}
 */
function anthbotCommandsStop() {
    return [{ cmd: "stop_all_tasks", data: 1 }];
}

/**
 * Возврат на базу.
 * @returns {Object[]}
 */
function anthbotCommandsDock() {
    return [{ cmd: "charge_start", data: 1 }];
}

/**
 * Просьба переопубликовать состояние. Косилка при этом никуда не едет.
 * @returns {Object}
 */
function anthbotCommandRefresh() {
    return { cmd: "get_all_props", data: 1 };
}

// Ход ножа Genie 800: ниже 30 и выше 70 мм не опускается и не поднимается. Значение вне
// диапазона косилка молча игнорирует — целиком команду, вместе с остальными полями param_set,
// поэтому обрезаем его здесь, а не полагаемся на настройки характеристики в хабе.
var ANTHBOT_HEIGHT_MIN_MM = 30;
var ANTHBOT_HEIGHT_MAX_MM = 70;

/**
 * Приводит высоту кошения к рабочему диапазону косилки.
 * @param {number} heightMm
 * @returns {number}
 */
function anthbotClampHeight(heightMm) {
    var mm = Math.round(heightMm);
    if (mm < ANTHBOT_HEIGHT_MIN_MM) return ANTHBOT_HEIGHT_MIN_MM;
    if (mm > ANTHBOT_HEIGHT_MAX_MM) return ANTHBOT_HEIGHT_MAX_MM;
    return mm;
}

/**
 * Высота кошения в миллиметрах, 30..70.
 * @param {number} heightMm
 * @returns {Object}
 */
function anthbotCommandHeight(heightMm) {
    return { cmd: "param_set", data: { cutter_height: anthbotClampHeight(heightMm), rid_switch: 0 } };
}

/**
 * Громкость голосовых подсказок, 0..100.
 * @param {number} percent
 * @returns {Object}
 */
function anthbotCommandVolume(percent) {
    return { cmd: "volume_ctl", data: { volume: Math.round(percent) } };
}

/**
 * Направление кошения. enable_adaptive_head инвертирован: 1 — автоподбор, 0 — своё направление.
 * @param {number} degrees 0..180
 * @param {boolean} customEnabled
 * @returns {Object}
 */
function anthbotCommandDirection(degrees, customEnabled) {
    return {
        cmd: "param_set",
        data: { mow_head: Math.round(degrees), enable_adaptive_head: customEnabled ? 0 : 1 }
    };
}

/**
 * Датчик дождя. Время паузы передаётся в секундах вместе с самим переключателем —
 * облако принимает обе настройки только целиком.
 * @param {boolean} enabled
 * @param {number} [continueTimeSec]
 * @returns {Object}
 */
function anthbotCommandRain(enabled, continueTimeSec) {
    var seconds = anthbotToInt(continueTimeSec);
    return {
        cmd: "ctl_rainer",
        data: {
            "switch": enabled ? 1 : 0,
            continue_time: (seconds !== null && seconds > 0) ? seconds : ANTHBOT_RAIN_DEFAULT_CONTINUE_SEC
        }
    };
}

/**
 * Включение и выключение режима кошения у базы.
 *
 * Живёт не в наборе настроек базы, а в общем param_set — проверено на Genie 800:
 * `param_set {nest_switch}` применяется за 5 секунд.
 *
 * @param {boolean} enabled
 * @returns {Object}
 */
function anthbotCommandNestEnabled(enabled) {
    return { cmd: "param_set", data: { nest_switch: enabled ? 1 : 0 } };
}

/**
 * Остальные настройки кошения у базы: высота, число проходов, визуальный контроль.
 *
 * Имя команды совпадает с именем поля состояния (`nest_param_set`), а облако ждёт весь набор
 * целиком — недостающие поля берутся из текущего состояния, а не обнуляются. Форма из
 * HA-интеграции (`set_mow_params` с ключами `nest_*`) на Genie 800 принимается облаком,
 * но косилкой игнорируется — проверено.
 *
 * @param {Object} reported текущее состояние косилки
 * @param {Object} overrides поля, которые меняем: cutter_height, mow_count, pobctl_switch, pobctl_level
 * @returns {Object}
 */
function anthbotCommandNestParams(reported, overrides) {
    var data = reported || {};
    var state = anthbotMapReported(data);
    var cutterHeight = anthbotToInt(anthbotGetPath(data, "param_set.cutter_height"));
    var payload = {
        cutter_height: state.nestCutterHeight !== null ? state.nestCutterHeight
                       : (cutterHeight === null ? 35 : cutterHeight),
        mow_count: state.nestMowCount === null ? 1 : state.nestMowCount,
        pobctl_level: state.nestInspectionLevel === null ? 1 : state.nestInspectionLevel,
        pobctl_switch: state.nestInspection ? 1 : 0
    };
    for (var key in overrides) {
        if (overrides.hasOwnProperty(key)) {
            payload[key] = anthbotIntOr(overrides[key], 0);
        }
    }
    // Нож у базы тот же самый — и диапазон высоты тот же
    payload.cutter_height = anthbotClampHeight(payload.cutter_height);
    return { cmd: "nest_param_set", data: payload };
}

function anthbotIntOr(value, fallback) {
    var parsed = anthbotToInt(value);
    return parsed === null ? fallback : parsed;
}

/**
 * Точки зоны для команды region_mow_start.
 *
 * Авто-зона в разметке Genie 800 описана одной точкой прямо в полях x и y, а не списком:
 * облако ждёт массив пар [[x, y]]. У других моделей встречается готовый список points/vertexs.
 *
 * @param {Object} zone
 * @returns {Array|null} null, если координат нет
 */
function anthbotZonePoints(zone) {
    if (zone.points && typeof zone.points.length === "number" && zone.points.length > 0) {
        return zone.points;
    }
    var x = anthbotToInt(zone.x);
    var y = anthbotToInt(zone.y);
    if (x !== null && y !== null) {
        return [[x, y]];
    }
    if (zone.vertexs && typeof zone.vertexs.length === "number" && zone.vertexs.length > 0) {
        return zone.vertexs;
    }
    return null;
}

/**
 * Кошение выбранных ручных зон.
 * @param {number[]} zoneIds
 * @returns {Object}
 */
function anthbotCommandZoneMow(zoneIds) {
    return { cmd: "custom_area_mow_start", data: { id: zoneIds } };
}

/**
 * Кошение авто-зоны: облако ждёт не идентификатор, а точки региона.
 * @param {Object[]} points
 * @returns {Object}
 */
function anthbotCommandAutoZoneMow(points) {
    return { cmd: "region_mow_start", data: { points: points } };
}

function anthbotZonesFrom(area, keys) {
    var source = area || {};
    for (var i = 0; i < keys.length; i++) {
        var list = source[keys[i]];
        if (list && typeof list.length === "number" && list.length > 0) {
            var out = [];
            for (var j = 0; j < list.length; j++) {
                var zone = list[j];
                if (!zone || typeof zone !== "object") {
                    continue;
                }
                var id = anthbotToInt(zone.id);
                out.push({
                    id: id === null ? j + 1 : id,
                    name: zone.name ? String(zone.name) : ("Зона " + (j + 1)),
                    points: anthbotZonePoints(zone)
                });
            }
            return anthbotSortZonesById(out);
        }
    }
    return [];
}

/**
 * Выстраивает зоны по возрастанию id.
 *
 * В файле разметки они лежат в порядке правок в приложении, а не по номерам: у живой Genie 800
 * это 100, 101, 102, 104, 103, 105. Кнопки же в хабе привязаны к позиции в списке — zone1 к
 * первой, zone2 ко второй и так далее, — поэтому без сортировки кнопка zone4 получала имя
 * «Zone 5», а zone5 — «Zone 4». На команды это не влияло (в облако уходит id, а не номер
 * кнопки), но выбирать зоны по таким подписям невозможно.
 *
 * Вставками, а не sort(): сортировка обязана быть устойчивой. У зон без id ключом становится
 * их позиция в файле, и при совпадении ключей порядок должен остаться исходным. Зон не больше
 * шестнадцати, стоимость значения не имеет.
 */
function anthbotSortZonesById(zones) {
    var out = zones.slice(0);
    for (var i = 1; i < out.length; i++) {
        var current = out[i];
        var j = i - 1;
        while (j >= 0 && out[j].id > current.id) {
            out[j + 1] = out[j];
            j--;
        }
        out[j + 1] = current;
    }
    return out;
}
