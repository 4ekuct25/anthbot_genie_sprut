/**
 * Разбор state.reported.
 *
 * Разные модели косилок раскладывают одно и то же по-разному, а формат Genie 800 до первой
 * разведки живого облака неизвестен. Поэтому маппинг проверяется на обоих известных вариантах
 * и на пустом ответе: сценарий не должен ни падать, ни выдавать выдуманные нули за показания.
 */

describe('AnthbotGenie — доступ к полям reported', () => {
  it('достаёт значение по вложенному пути', ({ scenario }) => {
    expect(scenario.call('anthbotGetPath', [{ a: { b: { c: 7 } } }, 'a.b.c'])).toBe(7);
  });

  it('несуществующий путь не роняет разбор', ({ scenario }) => {
    expect(scenario.call('anthbotGetPath', [{ a: 1 }, 'a.b.c'])).toBeUndefined();
    expect(scenario.call('anthbotGetPath', [null, 'a.b'])).toBeUndefined();
  });

  it('выбирает первый существующий путь из списка кандидатов', ({ scenario }) => {
    const data = { elec: { value: 55 } };
    expect(scenario.call('anthbotFirstDefined', [data, ['battery.value', 'elec.value', 'elec']])).toBe(55);
  });

  it('значение 0 считается существующим, а null — нет', ({ scenario }) => {
    expect(scenario.call('anthbotFirstDefined', [{ a: 0, b: 5 }, ['a', 'b']])).toBe(0);
    expect(scenario.call('anthbotFirstDefined', [{ a: null, b: 5 }, ['a', 'b']])).toBe(5);
  });
});

describe('AnthbotGenie — приведение типов из облака', () => {
  it('целые числа принимаются в любой из встречающихся форм', ({ scenario }) => {
    expect(scenario.call('anthbotToInt', [42])).toBe(42);
    expect(scenario.call('anthbotToInt', ['42'])).toBe(42);
    expect(scenario.call('anthbotToInt', [41.6])).toBe(42);
    expect(scenario.call('anthbotToInt', [{ value: 42 }])).toBe(42);
    expect(scenario.call('anthbotToInt', [true])).toBe(1);
  });

  it('не-число становится null, а не нулём', ({ scenario }) => {
    // Ноль вместо «нет данных» — это ложные показания в карточке устройства
    expect(scenario.call('anthbotToInt', ['нет'])).toBe(null);
    expect(scenario.call('anthbotToInt', [undefined])).toBe(null);
    expect(scenario.call('anthbotToInt', [{}])).toBe(null);
  });

  it('переключатели принимаются как 1/0, true/false и строками', ({ scenario }) => {
    expect(scenario.call('anthbotToBool', [1])).toBe(true);
    expect(scenario.call('anthbotToBool', [0])).toBe(false);
    expect(scenario.call('anthbotToBool', ['on'])).toBe(true);
    expect(scenario.call('anthbotToBool', ['enabled'])).toBe(true);
    expect(scenario.call('anthbotToBool', [{ value: true }])).toBe(true);
    expect(scenario.call('anthbotToBool', [undefined])).toBe(false);
  });
});

describe('AnthbotGenie — состояние косилки', () => {
  it('строковый статус читается напрямую', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [{ robot_sta: { value: 'backtodock' } }]);
    expect(state.statusKey).toBe('backtodock');
    expect(state.statusText).toBe('Возвращается на базу');
    expect(state.activity).toBe('returning');
    expect(state.mowing).toBe(false);
  });

  it('числовой код статуса разворачивается в ключ', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [{ robot_sta: { value: 6 } }]);
    expect(state.statusKey).toBe('globalmowing');
    expect(state.mowing).toBe(true);
  });

  it('формат новых моделей (mode вместо robot_sta) понимается тоже', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [{ mode: { value: 'zonemowing' } }]);
    expect(state.activity).toBe('mowing');
  });

  it('незнакомый статус не выдаётся за простой', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [{ robot_sta: { value: 'teleport' } }]);
    expect(state.activity).toBe('unknown');
    expect(state.mowing).toBe(false);
    expect(state.statusText).toBe('teleport');
  });

  it('заряд читается и в форме elec, и в форме elec.value', ({ scenario }) => {
    expect(scenario.call('anthbotMapReported', [{ elec: 73 }]).battery).toBe(73);
    expect(scenario.call('anthbotMapReported', [{ elec: { value: 73 } }]).battery).toBe(73);
  });

  it('зарядка определяется по статусу', ({ scenario }) => {
    expect(scenario.call('anthbotMapReported', [{ robot_sta: { value: 'charge' } }]).charging).toBe(true);
    expect(scenario.call('anthbotMapReported', [{ robot_sta: { value: 'idle' } }]).charging).toBe(false);
  });

  it('своё направление кошения — это ВЫКЛЮЧЕННЫЙ автоподбор', ({ scenario }) => {
    // enable_adaptive_head == 1 означает автоматику, то есть своё направление не действует
    expect(scenario.call('anthbotMapReported',
      [{ param_set: { enable_adaptive_head: 1 } }]).customDirection).toBe(false);
    expect(scenario.call('anthbotMapReported',
      [{ param_set: { enable_adaptive_head: 0 } }]).customDirection).toBe(true);
  });

  it('настройки кошения у базы разбираются целиком', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [{
      nest_switch: 1, nest_mow_count: 2, nest_cutter_height: 50,
      nest_pobctl_switch: 1, nest_pobctl_level: 0,
    }]);
    expect(state.nestEnabled).toBe(true);
    expect(state.nestMowCount).toBe(2);
    expect(state.nestCutterHeight).toBe(50);
    expect(state.nestInspection).toBe(true);
    expect(state.nestInspectionLevel).toBe(0);
  });

  it('пустой reported не даёт выдуманных показаний', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [{}]);
    expect(state.battery).toBe(null);
    expect(state.cutterHeight).toBe(null);
    expect(state.online).toBe(null);
    expect(state.statusKey).toBe('');
    expect(state.statusText).toBe('Состояние неизвестно');
  });

  it('активные зоны собираются из active_area', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [{ active_area: { id: [100, 101] } }]);
    expect(state.activeZoneIds).toEqual([100, 101]);
    expect(scenario.call('anthbotMapReported', [{}]).activeZoneIds).toEqual([]);
  });
});

describe('AnthbotGenie — реальный формат Genie 800', () => {
  // Снято с живой косилки через tools/probe.mjs 12.08.2026, прошивка 1.19.21.
  // Genie 800 держит половину полей плоско и по другим именам, чем 600/M5/M9,
  // ради которых писалась исходная HA-интеграция.
  const GENIE_800 = {
    online: 1,
    robot_sta: { time: 1786455219, value: 'charge' },
    elec: 100,
    volume: 25,
    err_code: 0,
    rtk_state: 1,
    rtk_base: { rtk_id: 1786381212, state: 2 },
    sta_ip_addr: '192.168.1.77',
    sta_ssid: 'Garden',
    map_area: 507,
    map_sta: { time: 1786455219, value: 'idle' },
    fw_version: { exten_board: 769, main_board: 327, system_version: '1.19.21' },
    rain_switch: 1,
    rain_continue_time: 3600,
    param_set: {
      cutter_height: 70, enable_adaptive_head: 0, mow_count: 1, mow_head: 180,
      mow_mode: 0, nest_switch: 1, rid_switch: 0,
    },
    nest_param_set: { cutter_height: 50, mow_count: 2, pobctl_level: 2, pobctl_switch: 1 },
    pobctl: { level: 1, switch: 1 },
    mow_remote: { cutter_ctl: 0, cutter_height: 50 },
    mowing_time_new: { time: 1786455018, value: 540 },
    mowing_area_new: { time: 1786455036, value: 5 },
    active_area: { id: [100, 101, 102, 103, 104, 105, 106] },
  };

  it('состояние, заряд и громкость читаются из плоских полей', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [GENIE_800]);
    expect(state.statusKey).toBe('charge');
    expect(state.statusText).toBe('На зарядке');
    expect(state.activity).toBe('docked');
    expect(state.charging).toBe(true);
    expect(state.battery).toBe(100);
    expect(state.volume).toBe(25);
    expect(state.online).toBe(true);
  });

  it('высота кошения берётся из param_set, а не из mow_remote', ({ scenario }) => {
    // У Genie 800 оба поля заполнены и расходятся: 70 против 50.
    // Верное — param_set: именно оно меняется командой param_set.
    const state = scenario.call('anthbotMapReported', [GENIE_800]);
    expect(state.cutterHeight).toBe(70);
    expect(state.mowDirection).toBe(180);
    expect(state.customDirection).toBe(true);
  });

  it('настройки базы собираются из param_set.nest_switch и nest_param_set', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [GENIE_800]);
    expect(state.nestEnabled).toBe(true);
    expect(state.nestMowCount).toBe(2);
    expect(state.nestCutterHeight).toBe(50);
    expect(state.nestInspection).toBe(true);
    expect(state.nestInspectionLevel).toBe(2);
  });

  it('диагностика читается из err_code, rtk_state, sta_ip_addr и sta_ssid', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [GENIE_800]);
    expect(state.errorCode).toBe(0);
    expect(state.rtkState).toBe(1);
    expect(state.ip).toBe('192.168.1.77');
    expect(state.ssid).toBe('Garden');
    expect(state.mapArea).toBe(507);
    expect(state.mapState).toBe('idle');
    expect(state.firmware).toBe('1.19.21');
  });

  it('наработка сессии и активные зоны разбираются', ({ scenario }) => {
    const state = scenario.call('anthbotMapReported', [GENIE_800]);
    expect(state.mowingTime).toBe(540);
    expect(state.mowingArea).toBe(5);
    expect(state.activeZoneIds).toHaveLength(7);
  });

  it('команда настроек базы сохраняет значения, прочитанные из формата Genie 800', ({ scenario }) => {
    // Ровно этот запрос подтверждён живой косилкой: nest_param_set со всем набором полей
    const command = scenario.call('anthbotCommandNestParams', [GENIE_800, { mow_count: 1 }]);

    expect(command.cmd).toBe('nest_param_set');
    expect(command.data).toEqual({
      cutter_height: 50, mow_count: 1, pobctl_switch: 1, pobctl_level: 2,
    });
  });
});

describe('AnthbotGenie — зоны из разметки участка', () => {
  it('ручные зоны берутся из custom_areas', ({ scenario }) => {
    const zones = scenario.call('anthbotManualZones',
      [{ custom_areas: [{ id: 100, name: 'Перед домом' }] }]);
    expect(zones).toHaveLength(1);
    expect(zones[0].id).toBe(100);
    expect(zones[0].name).toBe('Перед домом');
  });

  it('поддерживаются альтернативные имена полей', ({ scenario }) => {
    expect(scenario.call('anthbotManualZones', [{ zones: [{ id: 5 }] }])[0].id).toBe(5);
    expect(scenario.call('anthbotAutoZones', [{ regions: [{ id: 9 }] }])[0].id).toBe(9);
  });

  it('зона без имени получает подпись по порядку', ({ scenario }) => {
    expect(scenario.call('anthbotManualZones', [{ custom_areas: [{ id: 7 }] }])[0].name).toBe('Зона 1');
  });

  it('авто-зона несёт точки региона — по ним запускается кошение', ({ scenario }) => {
    const zones = scenario.call('anthbotAutoZones',
      [{ region_areas: [{ id: 1, name: 'Клумба', points: [[1, 2]] }] }]);
    expect(zones[0].points).toEqual([[1, 2]]);
  });

  it('авто-зона Genie 800 задана одной точкой в полях x и y', ({ scenario }) => {
    // Разметка живой Genie 800: region_areas = [{ id, name, x, y, … }] без списка точек,
    // а region_mow_start ждёт массив пар — иначе кнопка авто-зоны молча ничего не делает.
    const zones = scenario.call('anthbotAutoZones',
      [{ region_areas: [{ id: 0, name: 'Клумба', x: 2303, y: -13426 }] }]);
    expect(zones[0].points).toEqual([[2303, -13426]]);
  });

  it('ручная зона без координат не выдумывает точки', ({ scenario }) => {
    const zones = scenario.call('anthbotManualZones', [{ custom_areas: [{ id: 100, name: 'Газон' }] }]);
    expect(zones[0].points).toBe(null);
  });

  it('пустая или отсутствующая разметка даёт пустой список', ({ scenario }) => {
    expect(scenario.call('anthbotManualZones', [{}])).toEqual([]);
    expect(scenario.call('anthbotAutoZones', [null])).toEqual([]);
  });
});

describe('AnthbotGenie — сборка команд', () => {
  it('старт кошения предваряется пробуждением приложения', ({ scenario }) => {
    expect(scenario.call('anthbotCommandsStartMowing', [])).toEqual([
      { cmd: 'app_state', data: 1 },
      { cmd: 'mow_start', data: 1 },
    ]);
  });

  it('высота и громкость собираются в ожидаемой облаком форме', ({ scenario }) => {
    expect(scenario.call('anthbotCommandHeight', [45])).toEqual({
      cmd: 'param_set', data: { cutter_height: 45, rid_switch: 0 },
    });
    expect(scenario.call('anthbotCommandVolume', [70])).toEqual({
      cmd: 'volume_ctl', data: { volume: 70 },
    });
  });

  it('высота кошения не выходит за ход ножа 30..70 мм', ({ scenario }) => {
    // Значение вне диапазона косилка игнорирует вместе со всей командой param_set
    expect(scenario.call('anthbotCommandHeight', [10]).data.cutter_height).toBe(30);
    expect(scenario.call('anthbotCommandHeight', [100]).data.cutter_height).toBe(70);
    expect(scenario.call('anthbotCommandHeight', [30]).data.cutter_height).toBe(30);
    expect(scenario.call('anthbotCommandHeight', [70]).data.cutter_height).toBe(70);
  });

  it('высота у базы ограничена тем же диапазоном', ({ scenario }) => {
    const reported = { nest_param_set: { cutter_height: 40, mow_count: 2, pobctl_switch: 1, pobctl_level: 2 } };
    expect(scenario.call('anthbotCommandNestParams', [reported, { cutter_height: 5 }])
      .data.cutter_height).toBe(30);
    expect(scenario.call('anthbotCommandNestParams', [reported, { cutter_height: 90 }])
      .data.cutter_height).toBe(70);
  });

  it('направление кошения инвертирует признак автоподбора', ({ scenario }) => {
    expect(scenario.call('anthbotCommandDirection', [90, true]).data).toEqual({
      mow_head: 90, enable_adaptive_head: 0,
    });
    expect(scenario.call('anthbotCommandDirection', [90, false]).data.enable_adaptive_head).toBe(1);
  });

  it('датчик дождя без известного времени паузы получает значение по умолчанию', ({ scenario }) => {
    expect(scenario.call('anthbotCommandRain', [true, null]).data).toEqual({
      switch: 1, continue_time: 10800,
    });
    expect(scenario.call('anthbotCommandRain', [false, 7200]).data).toEqual({
      switch: 0, continue_time: 7200,
    });
  });

  it('включение кошения у базы идёт через общий param_set', ({ scenario }) => {
    // Проверено на живой Genie 800: nest_switch живёт в param_set, а не в наборе настроек базы
    expect(scenario.call('anthbotCommandNestEnabled', [true])).toEqual({
      cmd: 'param_set', data: { nest_switch: 1 },
    });
    expect(scenario.call('anthbotCommandNestEnabled', [false]).data).toEqual({ nest_switch: 0 });
  });

  it('настройки базы сохраняют текущие значения полей, которые не меняем', ({ scenario }) => {
    const reported = {
      nest_param_set: { cutter_height: 55, mow_count: 2, pobctl_switch: 1, pobctl_level: 2 },
    };

    const command = scenario.call('anthbotCommandNestParams', [reported, { mow_count: 1 }]);

    expect(command.cmd).toBe('nest_param_set');
    expect(command.data).toEqual({
      cutter_height: 55, mow_count: 1, pobctl_switch: 1, pobctl_level: 2,
    });
  });

  it('при пустом состоянии настройки базы получают разумные значения по умолчанию', ({ scenario }) => {
    const command = scenario.call('anthbotCommandNestParams', [{ param_set: { cutter_height: 40 } }, {}]);

    expect(command.data).toEqual({
      cutter_height: 40, mow_count: 1, pobctl_switch: 0, pobctl_level: 1,
    });
  });
});
