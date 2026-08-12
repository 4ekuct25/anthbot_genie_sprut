/**
 * Клиент облака Anthbot и плоскости данных AWS IoT — на моках HttpClient.
 *
 * Проверяется контракт, который сценарий обещает облаку: точные URL, обязательные заголовки,
 * форма тела и поведение при отказах. Тесты специально смотрят на то, что уйдёт в сеть,
 * а не на внутренние переменные: подпись SigV4 ломается именно от расхождения запрос↔подпись.
 */

const API = 'https://api.anthbot.com';
const ENDPOINT = 'a2bhy9nr7jkgaj-ats.iot.eu-central-1.amazonaws.com';
const SN = 'GN800TEST01';

function envelope(data) {
  return { status: 200, body: JSON.stringify({ code: 0, msg: 'ok', data: data }) };
}

function session() {
  return {
    sn: SN,
    endpoint: ENDPOINT,
    region: 'eu-central-1',
    creds: { accessKeyId: 'ASIATEST', secretAccessKey: 'secret', sessionToken: 'token' },
  };
}

/** Настраивает полный успешный сценарий логина и выдачи кредов. */
function mockHappyCloud(http, overrides) {
  const o = overrides || {};
  http.mock.onPost(`${API}/api/v1/login`, envelope({ access_token: o.token || 'ACCESS1' }));
  http.mock.onGet(`${API}/api/v1/device/bind/list`, envelope(o.devices || [
    { sn: SN, alias: 'Косилка', category_id: 'Genie 800', is_owner: 1 },
  ]));
  http.mock.onGet(`${API}/api/v1/device/v2/region`, envelope({
    region_name: 'eu-central-1', iot_endpoint: `https://${ENDPOINT}/`,
  }));
  http.mock.onPost(`${API}/api/v1/device/v2/iot/sts/arn`, envelope({
    access_key_id: 'ASIATEST', secret_access_key: 'secret', session_token: 'token',
    region_name: 'eu-central-1', endpoint: ENDPOINT, expiration: o.expiration || 3600,
  }));
}

describe('AnthbotGenie — логин', () => {
  it('шлёт POST на /api/v1/login с фирменными заголовками приложения', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/login`, envelope({ access_token: 'ACCESS1' }));

    const result = scenario.call('anthbotLogin', ['user@example.com', 'pass', '49']);

    expect(result.ok).toBe(true);
    expect(result.token).toBe('Bearer ACCESS1');
    const req = http.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${API}/api/v1/login`);
    expect(req.headers['version']).toBe('v2');
    expect(req.headers['language']).toBe('en');
    expect(req.headers['User-Agent']).toContain('LdMower');
    expect(JSON.parse(req.body)).toEqual({
      username: 'user@example.com', password: 'pass', areaCode: '49',
    });
  });

  it('отказ облака (code != 0) не роняет сценарий, а возвращает ошибку', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/login`,
      { status: 200, body: JSON.stringify({ code: 40001, msg: 'wrong password' }) });

    const result = scenario.call('anthbotLogin', ['user', 'bad', '49']);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('40001');
    expect(result.error).toContain('wrong password');
  });

  it('HTTP-ошибка возвращается со статусом', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/login`, { status: 502, body: 'bad gateway' });

    const result = scenario.call('anthbotLogin', ['user', 'pass', '49']);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it('мусор вместо JSON не роняет сценарий', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/login`, { status: 200, body: '<html>502</html>' });

    const result = scenario.call('anthbotLogin', ['user', 'pass', '49']);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('не является JSON');
  });

  it('ответ без access_token считается ошибкой', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/login`, envelope({ refresh_token: 'x' }));

    expect(scenario.call('anthbotLogin', ['user', 'pass', '49']).ok).toBe(false);
  });
});

describe('AnthbotGenie — список косилок', () => {
  it('разбирает sn, alias, модель и владельца', ({ scenario, http }) => {
    http.mock.onGet(`${API}/api/v1/device/bind/list`, envelope([
      { sn: SN, alias: 'Газон', category_id: 'Genie 800', is_owner: 1 },
      { sn: 'SECOND', category_id: 'Genie 600', is_owner: false },
    ]));

    const result = scenario.call('anthbotBindList', ['Bearer ACCESS1']);

    expect(result.ok).toBe(true);
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]).toEqual({ sn: SN, alias: 'Газон', model: 'Genie 800', isOwner: true });
    // без alias подставляется серийник
    expect(result.devices[1].alias).toBe('SECOND');
    expect(result.devices[1].isOwner).toBe(false);
    expect(http.requests[0].headers['Authorization']).toBe('Bearer ACCESS1');
  });

  it('записи без серийника пропускаются', ({ scenario, http }) => {
    http.mock.onGet(`${API}/api/v1/device/bind/list`, envelope([{ alias: 'мусор' }, { sn: SN }]));

    expect(scenario.call('anthbotBindList', ['Bearer X']).devices).toHaveLength(1);
  });
});

describe('AnthbotGenie — регион и IoT endpoint', () => {
  it('чистит endpoint от схемы и хвостового слэша', ({ scenario }) => {
    expect(scenario.call('anthbotNormalizeEndpoint', [`https://${ENDPOINT}/`])).toBe(ENDPOINT);
    expect(scenario.call('anthbotNormalizeEndpoint', [ENDPOINT])).toBe(ENDPOINT);
  });

  it('пустой endpoint заменяется значением по умолчанию', ({ scenario }) => {
    expect(scenario.call('anthbotNormalizeEndpoint', [''])).toBe(
      'a2bhy9nr7jkgaj-ats.iot.us-east-1.amazonaws.com');
  });

  it('регион берётся из хоста endpoint, а не из поля region_name', ({ scenario, http }) => {
    // Облако иногда отдаёт регион аккаунта, а подпись проверяет регион эндпоинта —
    // расхождение даёт вечный 403, поэтому приоритет у хоста.
    http.mock.onGet(`${API}/api/v1/device/v2/region`, envelope({
      region_name: 'us-east-1', iot_endpoint: `https://${ENDPOINT}`,
    }));

    const result = scenario.call('anthbotDeviceRegion', ['Bearer X', SN]);

    expect(result.ok).toBe(true);
    expect(result.regionName).toBe('eu-central-1');
    expect(result.iotEndpoint).toBe(ENDPOINT);
    expect(http.requests[0].url).toBe(`${API}/api/v1/device/v2/region?sn=${SN}`);
  });

  it('нераспознаваемый хост откатывается к region_name', ({ scenario, http }) => {
    http.mock.onGet(`${API}/api/v1/device/v2/region`, envelope({
      region_name: 'cn-northwest-1', iot_endpoint: 'gateway.example.com',
    }));

    expect(scenario.call('anthbotDeviceRegion', ['Bearer X', SN]).regionName).toBe('cn-northwest-1');
  });
});

describe('AnthbotGenie — временные AWS-креды', () => {
  it('шлёт verification_token в формате md5(sn+ts)+ts', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/device/v2/iot/sts/arn`, envelope({
      access_key_id: 'ASIATEST', secret_access_key: 'secret', session_token: 'token',
      region_name: 'eu-central-1', endpoint: ENDPOINT, expiration: 3600,
    }));

    const result = scenario.call('anthbotIotCredentials', ['Bearer X', SN]);

    expect(result.ok).toBe(true);
    expect(result.creds.accessKeyId).toBe('ASIATEST');
    expect(result.expiresInSec).toBe(3600);
    const body = JSON.parse(http.requests[0].body);
    expect(body.sn).toBe(SN);
    expect(/^[0-9a-f]{32}[0-9]{10}$/.test(body.verification_token)).toBe(true);
  });

  it('без поля expiration берётся час', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/device/v2/iot/sts/arn`, envelope({
      access_key_id: 'A', secret_access_key: 'B', session_token: 'C', endpoint: ENDPOINT,
    }));

    expect(scenario.call('anthbotIotCredentials', ['Bearer X', SN]).expiresInSec).toBe(3600);
  });

  it('неполный ответ STS — ошибка, а не половина кредов', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/device/v2/iot/sts/arn`, envelope({ access_key_id: 'A' }));

    expect(scenario.call('anthbotIotCredentials', ['Bearer X', SN]).ok).toBe(false);
  });
});

describe('AnthbotGenie — файл разметки участка', () => {
  it('берёт временную ссылку и скачивает по ней JSON зон', ({ scenario, http }) => {
    http.mock.onGet(`${API}/api/v1/device/v2/presigned_url`,
      envelope({ presigned_url: 'https://s3.eu-central-1.amazonaws.com/area.txt?sig=1' }));
    http.mock.onGet('https://s3.eu-central-1.amazonaws.com/area.txt',
      { status: 200, body: JSON.stringify({ custom_areas: [{ id: 100, name: 'Перед домом' }] }) });

    const result = scenario.call('anthbotAreaDefinition', ['Bearer X', SN]);

    expect(result.ok).toBe(true);
    expect(result.area.custom_areas[0].name).toBe('Перед домом');
    expect(http.requests[0].url).toContain(`filename=area_${SN}.txt`);
    expect(http.requests[0].url).toContain('sub_category=area');
    expect(http.requests).toHaveLength(2);
  });

  it('недоступная ссылка даёт ошибку со статусом', ({ scenario, http }) => {
    http.mock.onGet(`${API}/api/v1/device/v2/presigned_url`,
      envelope({ presigned_url: 'https://s3.example.com/area.txt' }));
    http.mock.onGet('https://s3.example.com/area.txt', { status: 403, body: 'expired' });

    const result = scenario.call('anthbotAreaDefinition', ['Bearer X', SN]);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('AnthbotGenie — чтение shadow', () => {
  it('идёт по точному URL и подписывает запрос', ({ scenario, http }) => {
    http.mock.onGet(`https://${ENDPOINT}/things/${SN}/shadow`, {
      status: 200,
      body: JSON.stringify({ state: { reported: { elec: 87, robot_sta: { value: 'charge' } } } }),
    });

    const result = scenario.call('anthbotGetShadow', [session(), 'property']);

    expect(result.ok).toBe(true);
    expect(result.reported.elec).toBe(87);
    const req = http.requests[0];
    expect(req.url).toBe(`https://${ENDPOINT}/things/${SN}/shadow?name=property`);
    expect(req.headers['Authorization']).toContain('AWS4-HMAC-SHA256 Credential=ASIATEST/');
    expect(req.headers['Authorization']).toContain('/eu-central-1/iotdata/aws4_request');
    expect(req.headers['x-amz-security-token']).toBe('token');
    expect(req.headers['host']).toBe(ENDPOINT);
  });

  it('подписанные заголовки перечислены в SignedHeaders и реально отправлены', ({ scenario, http }) => {
    http.mock.onGet(`https://${ENDPOINT}/things/${SN}/shadow`,
      { status: 200, body: JSON.stringify({ state: { reported: {} } }) });

    scenario.call('anthbotGetShadow', [session(), 'property']);

    const req = http.requests[0];
    const signed = /SignedHeaders=([^,]+),/.exec(req.headers['Authorization'])[1].split(';');
    for (const name of signed) {
      expect(req.headers[name]).toBeDefined();
    }
    expect(signed).toContain('host');
    expect(signed).toContain('x-amz-date');
    expect(signed).toContain('x-amz-content-sha256');
  });

  it('ответ без state.reported — ошибка', ({ scenario, http }) => {
    http.mock.onGet(`https://${ENDPOINT}/things/${SN}/shadow`,
      { status: 200, body: JSON.stringify({ state: { desired: {} } }) });

    expect(scenario.call('anthbotGetShadow', [session(), 'property']).ok).toBe(false);
  });

  it('403 возвращается со статусом — по нему обновляются креды', ({ scenario, http }) => {
    http.mock.onGet(`https://${ENDPOINT}/things/${SN}/shadow`,
      { status: 403, body: 'SignatureDoesNotMatch' });

    const result = scenario.call('anthbotGetShadow', [session(), 'property']);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('AnthbotGenie — отправка команд', () => {
  it('по умолчанию публикует команду в топик $aws с закодированным путём', ({ scenario, http }) => {
    // Живая проверка на Genie 800: только этот путь косилка исполняет.
    http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });

    const result = scenario.call('anthbotSendCommand', [session(), 'mow_start', 1]);

    expect(result.ok).toBe(true);
    const req = http.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe(
      `https://${ENDPOINT}/topics/%24aws%2Fthings%2F${SN}%2Fshadow%2Fname%2Fservice%2Fupdate`);
    expect(JSON.parse(req.body)).toEqual({ state: { desired: { cmd: 'mow_start', data: 1 } } });
  });

  it('канонический путь подписи кодируется второй раз — иначе AWS не примет', ({ scenario, http }) => {
    http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });

    scenario.call('anthbotSendCommand', [session(), 'mow_start', 1]);

    // SigV4 требует закодировать уже закодованный путь ещё раз: % → %25
    const authorization = http.requests[0].headers['Authorization'];
    const expected = scenario.call('anthbotSigV4Authorization', [{
      method: 'POST',
      canonicalUri: `/topics/%2524aws%252Fthings%252F${SN}%252Fshadow%252Fname%252Fservice%252Fupdate`,
      canonicalQuery: '',
      headers: {
        'content-type': 'application/octet-stream',
        host: ENDPOINT,
        'x-amz-content-sha256': http.requests[0].headers['x-amz-content-sha256'],
        'x-amz-date': http.requests[0].headers['x-amz-date'],
        'x-amz-security-token': 'token',
      },
      payloadHash: http.requests[0].headers['x-amz-content-sha256'],
      amzDate: http.requests[0].headers['x-amz-date'],
      region: 'eu-central-1',
      service: 'iotdata',
      accessKeyId: 'ASIATEST',
      secretAccessKey: 'secret',
    }]);
    expect(authorization).toBe(expected.authorization);
  });

  it('запасной вариант подписи меняет путь и на проводе, и в подписи', ({ scenario, http }) => {
    http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });

    scenario.call('anthbotSendCommand', [session(), 'mow_start', 1, { topicMode: 0 }]);
    scenario.call('anthbotSendCommand', [session(), 'mow_start', 1, { topicMode: 2 }]);

    // Вариант 0 — топик одним закодированным сегментом; вариант 2 — сырой путь топика
    expect(http.requests[0].url).toContain('%24aws%2Fthings');
    expect(http.requests[1].url).toBe(
      `https://${ENDPOINT}/topics/$aws/things/${SN}/shadow/name/service/update`);
    expect(http.requests[0].headers['Authorization'])
      .not.toBe(http.requests[1].headers['Authorization']);
  });

  it('изъятый вариант 1 не даёт третьей формы — работает как вариант 0', ({ scenario, http }) => {
    // Нумерация сохранена ради журнала, поэтому дыра в ней должна вести себя предсказуемо:
    // молча превратиться в вариант 0, а не отправить нечто среднее, чего AWS не примет.
    http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });

    scenario.call('anthbotSendCommand', [session(), 'mow_start', 1, { topicMode: 0 }]);
    scenario.call('anthbotSendCommand', [session(), 'mow_start', 1, { topicMode: 1 }]);

    expect(http.requests[1].url).toBe(http.requests[0].url);
    expect(http.requests[1].headers['Authorization'])
      .toBe(http.requests[0].headers['Authorization']);
  });

  it('хэш тела в заголовке совпадает с реально отправленным телом', ({ scenario, http }) => {
    http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });

    scenario.call('anthbotSendCommand', [session(), 'param_set', { cutter_height: 45, rid_switch: 0 }]);

    const req = http.requests[0];
    expect(req.headers['x-amz-content-sha256']).toBe(scenario.call('anthbotSha256Hex', [req.body]));
    expect(req.headers['content-type']).toBe('application/octet-stream');
  });

  it('по требованию пишет desired в service-shadow', ({ scenario, http }) => {
    http.mock.onPost(`https://${ENDPOINT}/things/${SN}/shadow`,
      { status: 200, body: JSON.stringify({ state: { desired: {} }, version: 5 }) });

    const result = scenario.call('anthbotSendCommand', [session(), 'mow_start', 1, { viaShadow: true }]);

    expect(result.ok).toBe(true);
    expect(http.requests[0].url).toBe(`https://${ENDPOINT}/things/${SN}/shadow?name=service`);
    expect(JSON.parse(http.requests[0].body))
      .toEqual({ state: { desired: { cmd: 'mow_start', data: 1 } } });
  });

  it('отказ команды не выдаётся за успех', ({ scenario, http }) => {
    http.mock.onPost(/\/topics\//, { status: 403, body: 'denied' });

    const result = scenario.call('anthbotSendCommand', [session(), 'mow_start', 1]);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('AnthbotGenie — жизненный цикл сессии', () => {
  it('первый вызов проходит логин, список, регион и STS', ({ scenario, http }) => {
    mockHappyCloud(http);
    const state = {};

    const result = scenario.call('anthbotEnsureSession',
      [state, { username: 'u', password: 'p', areaCode: '49' }]);

    expect(result.ok).toBe(true);
    expect(state.token).toBe('Bearer ACCESS1');
    expect(state.sn).toBe(SN);
    expect(state.alias).toBe('Косилка');
    expect(state.model).toBe('Genie 800');
    expect(state.endpoint).toBe(ENDPOINT);
    expect(state.region).toBe('eu-central-1');
    expect(state.creds.sessionToken).toBe('token');
    expect(http.requests).toHaveLength(4);
  });

  it('повторный вызов с живыми кредами не ходит в сеть', ({ scenario, http }) => {
    mockHappyCloud(http);
    const state = {};
    const config = { username: 'u', password: 'p', areaCode: '49' };

    scenario.call('anthbotEnsureSession', [state, config]);
    http.reset();
    mockHappyCloud(http);
    const result = scenario.call('anthbotEnsureSession', [state, config]);

    expect(result.ok).toBe(true);
    expect(http.requests).toHaveLength(0);
  });

  it('истёкшие креды переполучаются одним запросом STS', ({ scenario, http }) => {
    mockHappyCloud(http);
    const state = {};
    const config = { username: 'u', password: 'p', areaCode: '49' };

    scenario.call('anthbotEnsureSession', [state, config]);
    state.credsExpireAtMs = 1; // как будто час прошёл
    http.reset();
    mockHappyCloud(http);
    scenario.call('anthbotEnsureSession', [state, config]);

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].url).toContain('/iot/sts/arn');
  });

  it('креды обновляются заранее, за 5 минут до истечения', ({ scenario, http, time }) => {
    mockHappyCloud(http, { expiration: 3600 });
    const state = {};

    scenario.call('anthbotEnsureSession', [state, { username: 'u', password: 'p', areaCode: '49' }]);

    const lifetimeMs = state.credsExpireAtMs - time.now();
    expect(lifetimeMs).toBeLessThanOrEqual(3300 * 1000);
    expect(lifetimeMs).toBeGreaterThan(3200 * 1000);
  });

  it('короткий срок жизни кредов не даёт отрицательного окна', ({ scenario, http, time }) => {
    mockHappyCloud(http, { expiration: 120 });
    const state = {};

    scenario.call('anthbotEnsureSession', [state, { username: 'u', password: 'p', areaCode: '49' }]);

    expect(state.credsExpireAtMs - time.now()).toBeGreaterThanOrEqual(60 * 1000);
  });

  it('серийник из опций выбирает нужную косилку из нескольких', ({ scenario, http }) => {
    mockHappyCloud(http, {
      devices: [
        { sn: 'OTHER', alias: 'Соседская', category_id: 'Genie 600' },
        { sn: SN, alias: 'Моя', category_id: 'Genie 800' },
      ],
    });
    const state = {};

    scenario.call('anthbotEnsureSession',
      [state, { username: 'u', password: 'p', areaCode: '49', serialNumber: SN }]);

    expect(state.sn).toBe(SN);
    expect(state.alias).toBe('Моя');
  });

  it('несуществующий серийник — понятная ошибка, а не молчаливый выбор первой', ({ scenario, http }) => {
    mockHappyCloud(http, { devices: [{ sn: 'OTHER', alias: 'Соседская' }] });
    const state = {};

    const result = scenario.call('anthbotEnsureSession',
      [state, { username: 'u', password: 'p', areaCode: '49', serialNumber: SN }]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain(SN);
    expect(state.sn).toBeFalsy();
  });

  it('пустой аккаунт — понятная ошибка', ({ scenario, http }) => {
    mockHappyCloud(http, { devices: [] });

    const result = scenario.call('anthbotEnsureSession',
      [{}, { username: 'u', password: 'p', areaCode: '49' }]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('не привязано');
  });

  it('ошибка логина не оставляет полусобранную сессию', ({ scenario, http }) => {
    http.mock.onPost(`${API}/api/v1/login`, { status: 401, body: 'unauthorized' });
    const state = {};

    const result = scenario.call('anthbotEnsureSession',
      [state, { username: 'u', password: 'bad', areaCode: '49' }]);

    expect(result.ok).toBe(false);
    expect(state.token).toBeFalsy();
    expect(state.creds).toBeFalsy();
  });
});

describe('AnthbotGenie — сброс сессии по коду ошибки', () => {
  it('401 сбрасывает токен и креды', ({ scenario }) => {
    const state = { token: 'Bearer X', creds: { accessKeyId: 'A' }, sn: SN, endpoint: ENDPOINT };

    expect(scenario.call('anthbotInvalidateSession', [state, 401])).toBe(true);
    expect(state.token).toBeFalsy();
    expect(state.creds).toBeFalsy();
    // серийник и endpoint переживают перелогин — они не протухают
    expect(state.sn).toBe(SN);
  });

  it('403 сбрасывает только временные креды', ({ scenario }) => {
    const state = { token: 'Bearer X', creds: { accessKeyId: 'A' }, credsExpireAtMs: 9e15 };

    expect(scenario.call('anthbotInvalidateSession', [state, 403])).toBe(true);
    expect(state.token).toBe('Bearer X');
    expect(state.creds).toBeFalsy();
    expect(state.credsExpireAtMs).toBe(0);
  });

  it('прочие коды ничего не сбрасывают и не просят повтора', ({ scenario }) => {
    const state = { token: 'Bearer X', creds: { accessKeyId: 'A' } };

    expect(scenario.call('anthbotInvalidateSession', [state, 500])).toBe(false);
    expect(state.token).toBe('Bearer X');
    expect(state.creds).toBeDefined();
  });
});
