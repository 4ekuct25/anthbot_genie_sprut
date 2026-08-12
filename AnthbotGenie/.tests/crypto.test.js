/**
 * Крипто-слой глобального сценария против эталонных векторов.
 *
 * Свою реализацию MD5/SHA-256/HMAC на ES5 бессмысленно проверять «сама с собой»: тесты берут
 * только опубликованные векторы (FIPS 180-4, RFC 1321, RFC 4231) и официальный набор AWS
 * aws4_testsuite. Плюс негативные кейсы — иначе «зелёные» тесты можно получить и на заглушке.
 */

describe('AnthbotGenie — UTF-8 и hex', () => {
  it('ASCII кодируется байт в байт', ({ scenario }) => {
    expect(scenario.call('anthbotUtf8Bytes', ['abc'])).toEqual([97, 98, 99]);
  });

  it('кириллица кодируется двухбайтовыми последовательностями', ({ scenario }) => {
    // "привет" в UTF-8 — 12 байт
    const bytes = scenario.call('anthbotUtf8Bytes', ['привет']);
    expect(bytes).toHaveLength(12);
    expect(scenario.call('anthbotBytesToHex', [bytes])).toBe('d0bfd180d0b8d0b2d0b5d182');
  });

  it('эмодзи (суррогатная пара) кодируется четырьмя байтами', ({ scenario }) => {
    expect(scenario.call('anthbotBytesToHex', [scenario.call('anthbotUtf8Bytes', ['😀'])])).toBe('f09f9880');
  });

  it('hex дополняется нулём для байтов меньше 16', ({ scenario }) => {
    expect(scenario.call('anthbotBytesToHex', [[0, 5, 15, 16, 255]])).toBe('00050f10ff');
  });
});

describe('AnthbotGenie — SHA-256 (FIPS 180-4)', () => {
  it('пустая строка', ({ scenario }) => {
    expect(scenario.call('anthbotSha256Hex', [''])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('"abc"', ({ scenario }) => {
    expect(scenario.call('anthbotSha256Hex', ['abc'])).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('448-битное сообщение (два блока с паддингом)', ({ scenario }) => {
    expect(scenario.call('anthbotSha256Hex',
      ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'])).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('сообщение ровно в 55, 56 и 64 байта — границы паддинга', ({ scenario }) => {
    // 56 и 64 требуют дополнительного блока; 55 — последний размер, влезающий в один
    expect(scenario.call('anthbotSha256Hex', [new Array(56).join('a')])).toBe(
      '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
    expect(scenario.call('anthbotSha256Hex', [new Array(57).join('a')])).toBe(
      'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
    expect(scenario.call('anthbotSha256Hex', [new Array(65).join('a')])).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
  });

  it('UTF-8 хэшируется по байтам, а не по символам', ({ scenario }) => {
    expect(scenario.call('anthbotSha256Hex', ['привет'])).toBe(
      'e58f1e8c55fa105bdd3f40e5037eb0b039b5998d52c05e6cd98878dd2da5cab2');
  });

  it('изменение одного бита меняет дайджест целиком', ({ scenario }) => {
    const a = scenario.call('anthbotSha256Hex', ['abc']);
    const b = scenario.call('anthbotSha256Hex', ['abd']);
    expect(a).not.toBe(b);
  });
});

describe('AnthbotGenie — MD5 (RFC 1321)', () => {
  it('пустая строка', ({ scenario }) => {
    expect(scenario.call('anthbotMd5Hex', [''])).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('"abc"', ({ scenario }) => {
    expect(scenario.call('anthbotMd5Hex', ['abc'])).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('строка длиннее блока', ({ scenario }) => {
    expect(scenario.call('anthbotMd5Hex',
      ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'])).toBe(
      'd174ab98d277d9f5a5611c2c9f419d9f');
  });

  it('"The quick brown fox jumps over the lazy dog"', ({ scenario }) => {
    expect(scenario.call('anthbotMd5Hex',
      ['The quick brown fox jumps over the lazy dog'])).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('UTF-8 хэшируется по байтам', ({ scenario }) => {
    expect(scenario.call('anthbotMd5Hex', ['привет'])).toBe('608333adc72f545078ede3aad71bfe74');
  });
});

describe('AnthbotGenie — HMAC-SHA256 (RFC 4231)', () => {
  function hmacHex(scenario, keyBytes, msgBytes) {
    return scenario.call('anthbotBytesToHex',
      [scenario.call('anthbotHmacSha256Bytes', [keyBytes, msgBytes])]);
  }

  function repeat(byte, times) {
    const out = [];
    for (let i = 0; i < times; i++) out.push(byte);
    return out;
  }

  it('кейс 1: ключ из 20 байт 0x0b', ({ scenario }) => {
    const msg = scenario.call('anthbotUtf8Bytes', ['Hi There']);
    expect(hmacHex(scenario, repeat(0x0b, 20), msg)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('кейс 2: короткий текстовый ключ', ({ scenario }) => {
    expect(scenario.call('anthbotHmacSha256Hex', ['Jefe', 'what do ya want for nothing?'])).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('кейс 3: сообщение из 50 байт 0xdd', ({ scenario }) => {
    expect(hmacHex(scenario, repeat(0xaa, 20), repeat(0xdd, 50))).toBe(
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe');
  });

  it('кейс 6: ключ длиннее блока (131 байт) предварительно хэшируется', ({ scenario }) => {
    const msg = scenario.call('anthbotUtf8Bytes', ['Test Using Larger Than Block-Size Key - Hash Key First']);
    expect(hmacHex(scenario, repeat(0xaa, 131), msg)).toBe(
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('другой ключ — другой результат', ({ scenario }) => {
    const a = scenario.call('anthbotHmacSha256Hex', ['key1', 'payload']);
    const b = scenario.call('anthbotHmacSha256Hex', ['key2', 'payload']);
    expect(a).not.toBe(b);
  });
});

describe('AnthbotGenie — кодирование URI по правилам AWS', () => {
  it('unreserved-символы остаются как есть', ({ scenario }) => {
    expect(scenario.call('anthbotUriEncode', ['aZ0-._~', false])).toBe('aZ0-._~');
  });

  it('слэш сохраняется в пути и кодируется в значении', ({ scenario }) => {
    expect(scenario.call('anthbotUriEncode', ['/things/SN1/shadow', false])).toBe('/things/SN1/shadow');
    expect(scenario.call('anthbotUriEncode', ['/things/SN1', true])).toBe('%2Fthings%2FSN1');
  });

  it('спецсимволы кодируются в верхнем регистре', ({ scenario }) => {
    expect(scenario.call('anthbotUriEncode', ['$aws name', true])).toBe('%24aws%20name');
  });
});

describe('AnthbotGenie — подпись AWS SigV4 (aws4_testsuite: get-vanilla)', () => {
  const CREDS = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };

  function vanilla(scenario, overrides) {
    const req = {
      method: 'GET',
      canonicalUri: '/',
      canonicalQuery: '',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      amzDate: '20150830T123600Z',
      region: 'us-east-1',
      service: 'service',
      accessKeyId: CREDS.accessKeyId,
      secretAccessKey: CREDS.secretAccessKey,
    };
    for (const key in overrides || {}) req[key] = overrides[key];
    return scenario.call('anthbotSigV4Authorization', [req]);
  }

  it('канонический запрос собирается точно по спецификации', ({ scenario }) => {
    expect(vanilla(scenario).canonicalRequest).toBe(
      'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\n' +
      'host;x-amz-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('подпись совпадает с эталоном AWS', ({ scenario }) => {
    expect(vanilla(scenario).signature).toBe(
      '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('заголовок Authorization собран в ожидаемом формате', ({ scenario }) => {
    expect(vanilla(scenario).authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, ' +
      'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('заголовки сортируются и приводятся к нижнему регистру независимо от порядка', ({ scenario }) => {
    const signed = vanilla(scenario, {
      headers: { 'X-Amz-Date': '20150830T123600Z', Host: 'example.amazonaws.com' },
    });
    expect(signed.signedHeaders).toBe('host;x-amz-date');
    expect(signed.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('лишние пробелы в значении заголовка схлопываются', ({ scenario }) => {
    const signed = vanilla(scenario, {
      headers: { host: '  example.amazonaws.com  ', 'x-amz-date': '20150830T123600Z' },
    });
    expect(signed.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  // Контрольные негативные замеры: если подпись «не замечает» испорченный вход,
  // совпадение с эталоном выше ничего не доказывает.
  it('испорченный секрет даёт другую подпись', ({ scenario }) => {
    expect(vanilla(scenario, { secretAccessKey: CREDS.secretAccessKey + 'x' }).signature)
      .not.toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('другой регион, сервис или метод дают другую подпись', ({ scenario }) => {
    const base = vanilla(scenario).signature;
    expect(vanilla(scenario, { region: 'eu-west-1' }).signature).not.toBe(base);
    expect(vanilla(scenario, { service: 'iotdata' }).signature).not.toBe(base);
    expect(vanilla(scenario, { method: 'POST' }).signature).not.toBe(base);
  });

  it('ключ подписи кэшируется, но пересчитывается при смене даты', ({ scenario }) => {
    const day1 = vanilla(scenario).signature;
    const day2 = vanilla(scenario, { amzDate: '20150831T123600Z' }).signature;
    const day1again = vanilla(scenario).signature;
    expect(day2).not.toBe(day1);
    expect(day1again).toBe(day1);
  });
});

describe('AnthbotGenie — заголовки запроса к AWS IoT Data', () => {
  const CREDS = {
    accessKeyId: 'ASIAEXAMPLE',
    secretAccessKey: 'secret',
    sessionToken: 'session-token-value',
  };
  const HOST = 'a2bhy9nr7jkgaj-ats.iot.eu-central-1.amazonaws.com';

  function shadowGet(scenario, creds) {
    return scenario.call('anthbotSignedHeaders', [
      {
        method: 'GET',
        host: HOST,
        path: '/things/SN12345/shadow',
        query: 'name=property',
        body: '',
        region: 'eu-central-1',
        service: 'iotdata',
      },
      creds || CREDS,
      Date.UTC(2026, 7, 12, 10, 0, 0),
    ]);
  }

  it('GET подписывает host, дату и хэш пустого тела', ({ scenario }) => {
    const headers = shadowGet(scenario);
    expect(headers['x-amz-date']).toBe('20260812T100000Z');
    expect(headers['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(headers['host']).toBe(HOST);
  });

  it('временный session token попадает и в заголовки, и в подпись', ({ scenario }) => {
    const headers = shadowGet(scenario);
    expect(headers['x-amz-security-token']).toBe('session-token-value');
    expect(headers['Authorization']).toContain('x-amz-security-token');
  });

  it('без session token заголовок не добавляется и подпись другая', ({ scenario }) => {
    const withToken = shadowGet(scenario)['Authorization'];
    const withoutToken = shadowGet(scenario, {
      accessKeyId: CREDS.accessKeyId, secretAccessKey: CREDS.secretAccessKey,
    });
    expect(withoutToken['x-amz-security-token']).toBeUndefined();
    expect(withoutToken['Authorization']).not.toBe(withToken);
  });

  it('Content-Length не подписывается — его проставляет HttpClient хаба', ({ scenario }) => {
    const headers = scenario.call('anthbotSignedHeaders', [
      {
        method: 'POST',
        host: HOST,
        path: '/things/SN12345/shadow',
        query: 'name=service',
        body: '{"state":{"desired":{"cmd":"mow_start","data":1}}}',
        region: 'eu-central-1',
        service: 'iotdata',
      },
      CREDS,
      Date.UTC(2026, 7, 12, 10, 0, 0),
    ]);
    expect(headers['Authorization']).not.toContain('content-length');
    expect(headers['Authorization']).toContain('content-type');
    expect(headers['content-type']).toBe('application/octet-stream');
  });

  it('POST подписывает хэш реального тела, а не пустого', ({ scenario }) => {
    const body = '{"state":{"desired":{"cmd":"mow_start","data":1}}}';
    const headers = scenario.call('anthbotSignedHeaders', [
      { method: 'POST', host: HOST, path: '/things/SN12345/shadow', query: 'name=service',
        body: body, region: 'eu-central-1', service: 'iotdata' },
      CREDS,
      Date.UTC(2026, 7, 12, 10, 0, 0),
    ]);
    expect(headers['x-amz-content-sha256']).toBe(scenario.call('anthbotSha256Hex', [body]));
    expect(headers['x-amz-content-sha256']).not.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('AnthbotGenie — verification_token облака Anthbot', () => {
  it('склеивает md5(sn + ts) и сам ts', ({ scenario }) => {
    const token = scenario.call('anthbotVerificationToken', ['SN12345', 1754985600]);
    expect(token).toBe(scenario.call('anthbotMd5Hex', ['SN123451754985600']) + '1754985600');
    expect(token).toHaveLength(42);
  });

  it('без явного времени берёт текущее', ({ scenario }) => {
    const token = scenario.call('anthbotVerificationToken', ['SN12345']);
    expect(token).toHaveLength(32 + String(Math.floor(Date.now() / 1000)).length);
  });
});

describe('AnthbotGenie — время в формате AWS', () => {
  it('форматирует UTC как YYYYMMDDTHHMMSSZ', ({ scenario }) => {
    expect(scenario.call('anthbotAmzDate', [Date.UTC(2026, 0, 5, 7, 8, 9)])).toBe('20260105T070809Z');
  });

  it('однозначные компоненты дополняются нулём', ({ scenario }) => {
    expect(scenario.call('anthbotAmzDate', [Date.UTC(2026, 10, 30, 23, 59, 59)])).toBe('20261130T235959Z');
  });
});
