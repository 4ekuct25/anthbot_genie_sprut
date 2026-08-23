/**
 * AnthbotGenie.Logic — логический сценарий Sprut.Hub для роботов-газонокосилок Anthbot Genie.
 *
 * Привязывается к виртуальному аксессуару, имена сервисов которого заканчиваются ключевым
 * словом: «Кошение mow», «Высота кошения height» и т.д. — полный список в README.
 * Сценарий опрашивает облако Anthbot по таймеру, раскладывает состояние по характеристикам
 * и превращает изменения характеристик обратно в команды косилке.
 *
 * Требует глобального сценария AnthbotGenie.Global — в нём крипто, подпись SigV4 и клиент облака.
 * Его функции в песочнице хаба видны ТОЛЬКО через global.* — прямых имён нет, поэтому все вызовы
 * библиотеки идут с этим префиксом.
 */

const scenarioName = {
    ru: "🤖 Anthbot Genie — газонокосилка",
    en: "🤖 Anthbot Genie lawn mower"
};

const scenarioDescription = {
    ru: "Управление роботом-газонокосилкой Anthbot Genie через облако производителя.\n\n" +
        "Сценарий привязывается к виртуальному аксессуару, имена сервисов которого " +
        "заканчиваются ключевым словом — «Кошение mow», «Заряд battery», «Статус status» " +
        "и другие. Какие сервисы создать и как их назвать — в README сценария.\n\n" +
        "Требуется глобальный сценарий AnthbotGenie.Global.",
    en: "Control of the Anthbot Genie robotic mower through the vendor cloud.\n\n" +
        "Bind the scenario to a virtual accessory whose service names end with a key word — " +
        "mow, battery, status and so on. See the scenario README.\n\n" +
        "Requires the AnthbotGenie.Global global scenario."
};

info = {
    name: scenarioName.ru,
    description: scenarioDescription.ru,
    version: "1.0",
    author: "@s.panchenko",
    onStart: true,
    sourceServices: [HS.Switch, HS.C_Option],
    sourceCharacteristics: [HC.On, HC.C_Integer, HC.C_Boolean, HC.C_String],

    options: {
        username: {
            type: "String",
            value: "",
            maxLength: 128,
            name: { ru: "Логин Anthbot", en: "Anthbot login" },
            desc: {
                ru: "Тот же логин, что и в мобильном приложении Anthbot (телефон или e-mail)",
                en: "Same login as in the Anthbot mobile app (phone or e-mail)"
            }
        },
        password: {
            type: "String",
            value: "",
            maxLength: 128,
            name: { ru: "Пароль Anthbot", en: "Anthbot password" },
            desc: {
                ru: "Пароль от аккаунта Anthbot. Хранится в настройках хаба в открытом виде",
                en: "Anthbot account password. Stored in hub settings in plain text"
            }
        },
        areaCode: {
            type: "String",
            value: "7",
            maxLength: 5,
            name: { ru: "Код страны", en: "Country code" },
            desc: {
                ru: "Телефонный код страны аккаунта без плюса: 7 — Россия, 49 — Германия, 1 — США",
                en: "Account country calling code without the plus sign: 7 — Russia, 49 — Germany, 1 — USA"
            }
        },
        serialNumber: {
            type: "String",
            value: "",
            maxLength: 64,
            name: { ru: "Серийный номер косилки", en: "Mower serial number" },
            desc: {
                ru: "Нужен, только если к аккаунту привязано несколько косилок. Пусто — берётся первая",
                en: "Only needed when several mowers are bound to the account. Empty — the first one"
            }
        },
        pollIntervalSec: {
            type: "Integer",
            value: 60,
            minValue: 15,
            maxValue: 3600,
            step: 5,
            name: { ru: "Период опроса, сек", en: "Poll interval, sec" },
            desc: {
                ru: "Как часто спрашивать облако о состоянии косилки. Чаще 30 секунд смысла обычно нет",
                en: "How often to poll the cloud. Below 30 seconds is rarely useful"
            }
        },
        commandViaShadow: {
            type: "Boolean",
            value: false,
            name: { ru: "Команды через shadow", en: "Send commands via device shadow" },
            desc: {
                ru: "Запасной путь отправки команд. Genie 800 его игнорирует — включать только " +
                    "для других моделей, если обычный способ не работает",
                en: "Fallback command path. Genie 800 ignores it — enable only for other models " +
                    "if the default one does not work"
            }
        },
        valueInName: {
            type: "Boolean",
            value: true,
            name: { ru: "Значение в названии сервиса", en: "Show value in service name" },
            desc: {
                ru: "Плитка на рабочем столе показывает «Статус: На зарядке status». Нужно потому, " +
                    "что хаб не выводит значения сервиса «Параметр» на рабочий стол — только в карточку. " +
                    "Скрытые с рабочего стола сервисы не переименовываются",
                en: "Desktop tile shows «Статус: На зарядке status». Needed because the hub does not " +
                    "render Option service values on the desktop, only inside the device card. " +
                    "Services hidden from the desktop keep their names"
            }
        },
        debug: {
            type: "Boolean",
            value: false,
            name: { ru: "Отладка", en: "Debug" },
            desc: {
                ru: "Подробный лог: каждый опрос, каждая команда и полученное от облака состояние",
                en: "Verbose log: every poll, every command and the raw cloud state"
            }
        }
    },

    variables: {
        session: {},
        echo: {},
        zones: [],
        autoZones: [],
        zonesLoadedAtMs: 0,
        zoneTouchedAtMs: 0,
        appliedZoneSignature: "",
        pollTask: undefined,
        pollArmedAtMs: 0,
        lastError: ""
    }
};

// Характеристики, которые может нести сервис-«параметр». Порядок — приоритет поиска.
const ANTHBOT_VALUE_TYPES = [HC.On, HC.C_Integer, HC.C_Boolean, HC.C_String, HC.C_Double, HC.C_Long];

// Кнопки-импульсы: сами возвращаются в выключенное состояние после отправки команды.
const ANTHBOT_MOMENTARY_KEYS = "dock refresh";
const ANTHBOT_MOMENTARY_RESET_MS = 2000;

// Сколько времени собственная запись характеристики считается эхом, а не действием пользователя.
const ANTHBOT_ECHO_TTL_MS = 5000;

// Порядок перебора вариантов канонизации пути топика при упорном 403 — по убыванию доверия.
// 0 — рабочий по умолчанию; 2 — сырой путь, проверен на живом AWS и устойчив к нормализации
// (в нём нет %24/%2F, портить нечего). Текущий вариант из перебора исключается.
// Вариант 1 изъят как недостижимый — почему именно, см. anthbotPublishToTopic.
//
// Имя намеренно отличается от константы глобального сценария: сценарии делят одно пространство
// имён, и const поверх уже объявленного var роняет загрузку логического сценария целиком —
// без единой строки в логе.
const ANTHBOT_LOGIC_TOPIC_MODE_ORDER = [0, 2];

// Не переармировать опрос на каждый вызов trigger: при старте хаба и пересохранении сценария
// хаб переигрывает все характеристики разом, и без этого окна получился бы залп опросов.
const ANTHBOT_REARM_DEBOUNCE_MS = 10000;

/**
 * Точка входа. Вызывается хабом при изменении характеристик привязанного аксессуара,
 * при старте хаба и при каждом сохранении сценария.
 */
function trigger(source, value, variables, options, context) {
    const service = source.getService();
    const accessory = service.getAccessory();

    anthbotInitVariables(variables);
    variables.boundServiceUuid = String(service.getUUID());

    // Собственная запись сценария не поднимает ни таймер, ни подписку: и то и другое
    // унаследовало бы цепочку причин этого вызова, а в ней уже есть наш собственный опрос.
    // Почему это смертельно — см. anthbotEnsurePolling.
    const selfCaused = anthbotIsEcho(source, value, variables) ||
        anthbotIsSelfChangeByContext(context);
    if (!selfCaused) {
        anthbotEnsurePolling(accessory, variables, options);
        anthbotEnsureSubscription(accessory, variables, options);
    }

    // Переигрывание характеристик хабом командой не считается, но таймер по нему поднять нужно:
    // после старта хаба других поводов войти в trigger может и не быть.
    if (selfCaused || anthbotIsSystemReplayContext(context)) {
        return;
    }

    const key = anthbotServiceKey(service);
    if (!key) {
        anthbotLog(options, "Сервис «" + service.getName() + "» без ключа в имени — игнорирую");
        return;
    }

    // Контекст в логе обязателен: без него нажатие в интерфейсе и переигрывание характеристики
    // хабом выглядят в журнале одинаково, и разобрать «кто отправил косилку» уже нельзя.
    anthbotLog(options, "изменение [" + key + "] = " + value + " от " + context);
    anthbotHandleUserChange(key, accessory, source, value, variables, options);
}

// ============================================================================
// Состояние сценария
// ============================================================================

function anthbotInitVariables(variables) {
    if (!variables.session) variables.session = {};
    if (!variables.echo) variables.echo = {};
    if (!variables.zones) variables.zones = [];
    if (!variables.autoZones) variables.autoZones = [];
}

function anthbotNowMs() {
    return new Date().getTime();
}

function anthbotConfig(options) {
    return {
        username: options.username,
        password: options.password,
        areaCode: options.areaCode,
        serialNumber: options.serialNumber
    };
}

function anthbotLog(options, message) {
    if (options.debug) {
        console.info("[Anthbot] " + message);
    }
}

// ============================================================================
// Сервисы виртуального аксессуара
// ============================================================================

// Все ключи, по которым сценарий узнаёт сервисы виртуального аксессуара.
const ANTHBOT_SERVICE_KEYS =
    "mow dock refresh battery status height volume dir dirauto rain raintime " +
    "nest nestcount nestheight nestcheck nestlevel " +
    "error rtk ip ssid fw mapstate maparea time area timetotal areatotal";

/**
 * Ключ сервиса — последнее слово его имени: «Высота кошения height» → "height".
 *
 * Имя сервиса пользователь задаёт сам, поэтому привязка идёт по ключевому слову, а не по имени
 * целиком. Слово сверяется со списком известных ключей — случайное совпадение с обычным словом
 * в конце названия исключено. Квадратные скобки вокруг ключа допускаются, но не обязательны:
 * хаб их из имени вырезает.
 */
function anthbotServiceKey(service) {
    // Скобки заменяются пробелом, поэтому хвостовые пробелы нужно убрать: иначе
    // последним «словом» станет пустая строка и ключ потеряется.
    const name = String(service.getName() || "").replace(/[\[\]]/g, " ").replace(/^\s+|\s+$/g, "");
    const parts = name.split(/\s+/);
    const last = String(parts[parts.length - 1] || "").toLowerCase();

    if (!last) {
        return "";
    }
    if ((" " + ANTHBOT_SERVICE_KEYS + " ").indexOf(" " + last + " ") >= 0) {
        return last;
    }
    if (/^a?zone[0-9]{1,2}$/.test(last)) {
        return last;
    }
    return "";
}

/**
 * Карта «ключ → сервис» по всем сервисам аксессуара.
 */
function anthbotServiceMap(accessory) {
    const map = {};
    const services = accessory.getServices();
    for (let i = 0; i < services.length; i++) {
        const key = anthbotServiceKey(services[i]);
        if (key) {
            map[key] = services[i];
        }
    }
    return map;
}

/**
 * Характеристика-значение сервиса: у «Параметра» это C_Integer/C_String/..., у выключателя — On.
 */
function anthbotValueCharacteristic(service) {
    if (!service) {
        return null;
    }
    for (let i = 0; i < ANTHBOT_VALUE_TYPES.length; i++) {
        const characteristic = anthbotSafeCharacteristic(service, ANTHBOT_VALUE_TYPES[i]);
        if (characteristic) {
            return characteristic;
        }
    }
    return null;
}

function anthbotSafeCharacteristic(service, type) {
    try {
        return service.getCharacteristic(type) || null;
    } catch (e) {
        return null;
    }
}

// ============================================================================
// Запись в характеристики и защита от эха
// ============================================================================

/**
 * Пишет значение и запоминает запись как собственную.
 *
 * Любая запись сценария снова вызывает trigger — без пометки эхом сценарий принял бы
 * собственное обновление статуса за команду пользователя и отправил бы её косилке.
 */
function anthbotWrite(characteristic, value, variables) {
    if (characteristic === null || characteristic === undefined || value === null || value === undefined) {
        return;
    }
    if (characteristic.getValue() === value) {
        return;
    }
    variables.echo[String(characteristic.getUUID())] = { value: value, atMs: anthbotNowMs() };
    characteristic.setValue(value);
}

function anthbotWriteServiceValue(services, key, value, variables) {
    anthbotWrite(anthbotValueCharacteristic(services[key]), value, variables);
}

function anthbotIsEcho(source, value, variables) {
    const uuid = String(source.getUUID());
    const record = variables.echo[uuid];
    if (!record) {
        return false;
    }
    if (anthbotNowMs() - record.atMs > ANTHBOT_ECHO_TTL_MS) {
        delete variables.echo[uuid];
        return false;
    }
    if (record.value === value) {
        delete variables.echo[uuid];
        return true;
    }
    return false;
}

/**
 * Изменение сделано самим сценарием. Шаблон контекста: 'LOGIC <- C <- LOGIC'.
 * Приём подсмотрен в сценарии VirtualThermostat — там он отделяет ручное вмешательство
 * от собственных записей.
 */
function anthbotIsSelfChangeByContext(context) {
    const elements = String(context).split(" <- ");
    return elements.length >= 3 &&
        elements[0].indexOf("LOGIC") === 0 &&
        elements[1].indexOf("C") === 0 &&
        elements[2] === elements[0];
}

/**
 * Системное переигрывание характеристик (старт хаба, пересохранение привязки логики),
 * а не действие пользователя.
 */
function anthbotIsSystemReplayContext(context) {
    const ctx = String(context);
    if (ctx.indexOf("HUB[OnStart]") >= 0) {
        return true;
    }
    const elements = ctx.split(" <- ");
    return elements.length >= 2 &&
        elements[0].indexOf("LOGIC") === 0 &&
        elements[1].indexOf("C[") !== 0;
}

// ============================================================================
// Опрос облака
// ============================================================================

/**
 * Поднимает периодический опрос, гарантируя ровно один активный таймер.
 *
 * Без снятия прежней задачи каждое сохранение сценария добавляло бы ещё один таймер —
 * опрос незаметно ускорялся бы в разы, пока облако не начнёт отвечать отказами.
 *
 * Вызывать ТОЛЬКО из trigger'а, вызванного не самим сценарием (см. selfCaused в trigger).
 * Хаб тянет цепочку причин через таймеры: задача, поставленная здесь, наследует контекст
 * текущего вызова целиком. Если поставить её из trigger'а, который сам поднят нашей же
 * записью в характеристику, каждый цикл опроса удлиняет цепочку на «LOGIC ← C» —
 * за четверть часа она упирается в предел хаба в 32 звена, и дальше КАЖДЫЙ опрос падает
 * с «Max call stack size exceeded (32)» на первой же записи. Опрос при этом не
 * останавливается, но состояние раскладывается лишь до места падения: в карточке живёт
 * один статус, остальное застывает. Так и вышло на живом хабе 22.08.2026: в логе цепочка
 * «LOGIC[8_Service 48.13] ← C[48.13.15 Switch.On] ← …» на 16 повторов, ошибка раз в минуту.
 */
function anthbotEnsurePolling(accessory, variables, options) {
    const now = anthbotNowMs();
    if (variables.pollTask && (now - variables.pollArmedAtMs) < ANTHBOT_REARM_DEBOUNCE_MS) {
        return;
    }

    if (variables.pollTask) {
        clear(variables.pollTask);
        variables.pollTask = undefined;
    }

    const intervalMs = Math.max(Number(options.pollIntervalSec) || 60, 15) * 1000;
    variables.pollArmedAtMs = now;
    variables.pollTask = setInterval(function () {
        anthbotPoll(accessory, variables, options);
    }, intervalMs);

    anthbotLog(options, "Опрос облака поднят с периодом " + (intervalMs / 1000) + " с");
    setTimeout(function () {
        anthbotPoll(accessory, variables, options);
    }, 500);
}

/**
 * Подписывается на изменения остальных сервисов того же аксессуара.
 *
 * Логика в Sprut.Hub привязывается к ОДНОМУ сервису, и trigger вызывается только для него.
 * Без этой подписки кнопки зон, высота, громкость и настройки базы в хабе переключались бы,
 * но до косилки не доезжали.
 *
 * Подписка глобальная (по типам сервисов и характеристик), поэтому чужие устройства
 * отсекаются по идентификатору аксессуара, а сервис, к которому привязана логика, —
 * по UUID: его изменения приходят обычным путём через trigger, и обработать их дважды
 * означало бы отправить команду дважды.
 */
function anthbotEnsureSubscription(accessory, variables, options) {
    if (variables.subscription) {
        return;
    }

    const accessoryUuid = String(accessory.getUUID());
    variables.subscription = Hub.subscribeWithCondition("", "",
        [HS.Switch, HS.C_Option],
        [HC.On, HC.C_Integer, HC.C_Boolean, HC.C_String],
        function (source, value) {
            const changed = source.getService();
            if (String(changed.getAccessory().getUUID()) !== accessoryUuid) {
                return;
            }
            if (String(changed.getUUID()) === variables.boundServiceUuid) {
                return;
            }
            // В подписку контекст изменения не приходит, поэтому собственные записи
            // отсеиваются только по журналу эха.
            if (anthbotIsEcho(source, value, variables)) {
                return;
            }

            const key = anthbotServiceKey(changed);
            if (!key) {
                return;
            }
            anthbotLog(options, "изменение сервиса [" + key + "] = " + value + " через подписку");
            anthbotHandleUserChange(key, accessory, source, value, variables, options);
        });
}

/**
 * Один цикл опроса: состояние косилки → характеристики аксессуара.
 */
function anthbotPoll(accessory, variables, options) {
    const services = anthbotServiceMap(accessory);

    if (!options.username || !options.password) {
        anthbotReportError(services, variables, "не заполнены логин и пароль Anthbot");
        return;
    }

    const shadow = anthbotFetchShadow(variables, options);
    if (!shadow.ok) {
        anthbotReportError(services, variables, shadow.error);
        return;
    }

    if (variables.lastError) {
        console.info("[Anthbot] связь с облаком восстановлена");
        variables.lastError = "";
    }
    anthbotLog(options, "Состояние: " + JSON.stringify(shadow.reported));

    anthbotLoadZones(variables, options);
    anthbotApplyState(global.anthbotMapReported(shadow.reported), shadow.reported, services, variables, options);
}

/**
 * Читает shadow, обновляя сессию, если облако отвергло токен или временные креды.
 */
function anthbotFetchShadow(variables, options) {
    const session = global.anthbotEnsureSession(variables.session, anthbotConfig(options));
    if (!session.ok) {
        return session;
    }

    const first = global.anthbotGetShadow(variables.session, "property");
    if (first.ok) {
        return first;
    }
    if (!global.anthbotInvalidateSession(variables.session, first.status)) {
        return first;
    }

    anthbotLog(options, "облако отвергло запрос (HTTP " + first.status + "), обновляю доступ");
    const renewed = global.anthbotEnsureSession(variables.session, anthbotConfig(options));
    if (!renewed.ok) {
        return renewed;
    }
    return global.anthbotGetShadow(variables.session, "property");
}

function anthbotReportError(services, variables, message) {
    // Одна и та же ошибка не должна засорять лог на каждом опросе.
    if (variables.lastError !== message) {
        console.warn("[Anthbot] " + message);
        variables.lastError = message;
    }
    anthbotWriteServiceValue(services, "status", "Нет связи: " + message, variables);
}

/**
 * Разметка участка нужна только для зон и меняется редко — перечитываем раз в сутки.
 */
function anthbotLoadZones(variables, options) {
    const dayMs = 24 * 60 * 60 * 1000;
    if (variables.zonesLoadedAtMs && (anthbotNowMs() - variables.zonesLoadedAtMs) < dayMs) {
        return;
    }

    const area = global.anthbotAreaDefinition(variables.session.token, variables.session.sn);
    if (!area.ok) {
        anthbotLog(options, "разметка участка недоступна: " + area.error);
        variables.zonesLoadedAtMs = anthbotNowMs();
        return;
    }

    variables.zones = global.anthbotManualZones(area.area);
    variables.autoZones = global.anthbotAutoZones(area.area);
    variables.zonesLoadedAtMs = anthbotNowMs();
    anthbotLog(options, "зон: " + variables.zones.length + ", авто-зон: " + variables.autoZones.length);
}

// ============================================================================
// Состояние косилки → характеристики
// ============================================================================

function anthbotApplyState(state, reported, services, variables, options) {
    variables.reported = reported;
    anthbotVerifyPending(state, variables);

    anthbotWriteServiceValue(services, "status", anthbotStatusLine(state), variables);
    anthbotWriteServiceValue(services, "mow", state.mowing, variables);
    anthbotApplyBattery(services["battery"], state, variables);

    anthbotWriteServiceValue(services, "height", state.cutterHeight, variables);
    anthbotWriteServiceValue(services, "volume", state.volume, variables);
    anthbotWriteServiceValue(services, "dir", state.mowDirection, variables);
    anthbotWriteServiceValue(services, "dirauto", state.customDirection, variables);
    anthbotWriteServiceValue(services, "rain", state.rainEnabled, variables);
    anthbotWriteServiceValue(services, "raintime", anthbotSecondsToHours(state.rainContinueTime), variables);

    anthbotWriteServiceValue(services, "nest", state.nestEnabled, variables);
    anthbotWriteServiceValue(services, "nestcount", state.nestMowCount, variables);
    anthbotWriteServiceValue(services, "nestheight", state.nestCutterHeight, variables);
    anthbotWriteServiceValue(services, "nestcheck", state.nestInspection, variables);
    anthbotWriteServiceValue(services, "nestlevel", state.nestInspectionLevel, variables);

    anthbotWriteServiceValue(services, "error", anthbotErrorText(state.errorCode), variables);
    anthbotWriteServiceValue(services, "rtk", anthbotAsText(state.rtkState), variables);
    anthbotWriteServiceValue(services, "ip", anthbotAsText(state.ip), variables);
    anthbotWriteServiceValue(services, "ssid", anthbotAsText(state.ssid), variables);
    anthbotWriteServiceValue(services, "maparea", state.mapArea, variables);
    anthbotWriteServiceValue(services, "mapstate", anthbotAsText(state.mapState), variables);
    anthbotWriteServiceValue(services, "fw", anthbotAsText(state.firmware), variables);
    anthbotWriteServiceValue(services, "time", anthbotSecondsToMinutes(state.mowingTime), variables);
    anthbotWriteServiceValue(services, "area", state.mowingArea, variables);
    anthbotWriteServiceValue(services, "timetotal", anthbotSecondsToMinutes(state.mowingTimeTotal), variables);
    anthbotWriteServiceValue(services, "areatotal", state.mowingAreaTotal, variables);

    anthbotApplyZoneNames(services, variables);
    anthbotApplyActiveZones(services, state, variables, options);
    anthbotApplyDesktopDefaults(services, variables, options);
    anthbotApplyValueNames(services, options);
}

// Сколько отметка зон, сделанная человеком, защищена от перезаписи облаком.
// Меньше периода опроса брать нельзя: выбор из нескольких зон занимает не одну минуту.
const ANTHBOT_ZONE_HOLD_MS = 5 * 60 * 1000;

/**
 * Подсвечивает кнопки зон составом текущего задания косилки.
 *
 * Что такое active_area, выяснено замерами на живой Genie 800 (прошивка 1.20.9) 23.08.2026 —
 * из кода облака это не следует, а первая догадка была неверной:
 *   • это НЕ список зон карты: при шести зонах на карте в задании из одной зоны там один id;
 *   • это НЕ «оставшиеся» зоны: за многочасовое задание из шести зон список не укоротился;
 *   • список ПЕРЕЖИВАЕТ завершение задания: полтора часа на базе с законченным заданием
 *     косилка продолжала отдавать прежнюю шестёрку.
 * Последнее и делает подсветку осмысленной в простое: кнопки показывают, что уедет
 * следующим нажатием «Кошение», а не гаснут, едва робот встал на базу.
 *
 * Пустой список не трогает кнопки вовсе. Он приходит, когда зонального задания не было ни
 * разу, и затирать по нему выбор владельца хаба нельзя: «косилка молчит» — не то же самое,
 * что «ничего не выбрано».
 *
 * Авто-зоны не подсвечиваются, и это проверено, а не предположено: 23.08.2026 владелец хаба
 * дважды запускал кошение авто-зоны из приложения, и active_area оба раза осталась составом
 * ПРОШЛОГО задания по ручным зонам. Авто-задание видно по другой паре полей — mow_region и
 * region_area.points, — но сопоставить точку задания с записью в разметке нельзя: координаты
 * расходятся на метры. Подсветить не ту зону хуже, чем не подсветить вовсе.
 *
 * Кнопки переписываются, ТОЛЬКО когда состав задания изменился с прошлого применённого.
 * Иначе опрос затирает свежий выбор человека: он гасит зону, жмёт «Кошение» (окно защиты при
 * этом снимается — выбор израсходован), а ближайший опрос видит прежнюю active_area и зажигает
 * зону обратно. Особенно заметно после авто-задания: active_area его не отражает вовсе, и в
 * кнопках воскресает ручная зона, к происходящему отношения не имеющая. Поймано на живом хабе.
 */
function anthbotApplyActiveZones(services, state, variables, options) {
    const active = state.activeZoneIds;
    if (!active || active.length === 0) {
        return;
    }

    const signature = anthbotZoneSignature(active);
    if (signature === variables.appliedZoneSignature) {
        return;
    }
    if (anthbotZonesHeldByUser(variables)) {
        // Подпись не запоминаем: облако сказало новое, применить это нужно, но позже
        anthbotLog(options, "подсветка зон отложена: выбор только что правил человек");
        return;
    }

    variables.appliedZoneSignature = signature;
    for (let index = 1; index <= 16; index++) {
        const zone = variables.zones[index - 1];
        if (!zone) {
            continue;
        }
        const characteristic = anthbotValueCharacteristic(services["zone" + index]);
        anthbotWrite(characteristic, anthbotContainsId(active, zone.id), variables);
    }
}

/**
 * Отпечаток состава задания, по которому видно, что облако сказало что-то новое.
 * Порядок идентификаторов косилка меняет от опроса к опросу, поэтому перед склейкой сортируем:
 * иначе перестановка тех же зон выглядела бы новым заданием и затирала выбор человека.
 */
function anthbotZoneSignature(ids) {
    return ids.slice(0).sort(function (a, b) { return a - b; }).join(",");
}

function anthbotContainsId(ids, id) {
    for (let i = 0; i < ids.length; i++) {
        if (ids[i] === id) {
            return true;
        }
    }
    return false;
}

/**
 * Отметку зон, сделанную человеком, облако какое-то время не перебивает.
 *
 * Без этого окна выбор нельзя собрать в принципе: список задания переживает его завершение,
 * поэтому на базе косилка отдаёт состав ПРОШЛОГО задания — и первый же опрос вернул бы
 * старые зоны поверх новых отметок, не дав дойти до «Кошение».
 */
function anthbotZonesHeldByUser(variables) {
    if (!variables.zoneTouchedAtMs) {
        return false;
    }
    if (anthbotNowMs() - variables.zoneTouchedAtMs < ANTHBOT_ZONE_HOLD_MS) {
        return true;
    }
    variables.zoneTouchedAtMs = 0;
    return false;
}

function anthbotIsZoneKey(key) {
    return key.indexOf("zone") === 0 || key.indexOf("azone") === 0;
}

// Сервисы, которых на рабочем столе быть не должно: настройки «поставил и забыл» и диагностика.
// Порядок плиток задаётся порядком создания сервисов и в интерфейсе меняется только вручную,
// поэтому единственный способ получить читаемый стол — не выводить на него лишнее.
const ANTHBOT_DESKTOP_HIDDEN_KEYS = "refresh volume dirauto rain raintime nest nestcount " +
    "nestheight nestcheck nestlevel rtk ip ssid fw mapstate maparea";

/**
 * Один раз убирает редкие сервисы с рабочего стола — при первом опросе после запуска сценария.
 *
 * Именно один раз: вернуть плитку обратно — право владельца хаба, и сценарий, который скрывал бы
 * её на каждом опросе, отобрал бы это право. Флаг живёт в variables, то есть переживает опросы,
 * но сбрасывается при перезапуске логики — тогда умолчания применятся снова.
 */
function anthbotApplyDesktopDefaults(services, variables, options) {
    if (variables.desktopDefaultsApplied) {
        return;
    }
    variables.desktopDefaultsApplied = true;

    const keys = ANTHBOT_DESKTOP_HIDDEN_KEYS.split(" ");
    const hidden = [];
    for (let index = 0; index < keys.length; index++) {
        const service = services[keys[index]];
        if (service && service.isVisible()) {
            service.setVisible(false);
            hidden.push(keys[index]);
        }
    }
    if (hidden.length > 0) {
        anthbotLog(options, "скрыто с рабочего стола: " + hidden.join(", "));
    }
}

// Подписи и единицы для сервисов, у которых значение выносится в название.
// Только «Параметры»: выключатели и батарея показывают значение на плитке сами.
const ANTHBOT_NAME_LABELS = {
    status: "Статус", height: "Высота", volume: "Громкость", dir: "Направление",
    raintime: "Пауза дождя", nestcount: "Проходов у базы", nestheight: "Высота у базы",
    nestlevel: "Контроль у базы", error: "Ошибка", rtk: "RTK", ip: "IP", ssid: "Wi-Fi",
    fw: "Прошивка", mapstate: "Карта", maparea: "Площадь карты",
    // «Задания», а не «сессии»: счётчики косилки живут от задания до задания и переживают
    // перерыв на зарядку. Проверено на живой Genie 800 23.08.2026 — у задания, шедшего через
    // подзарядку, здесь было 147 минут при 34 минутах с момента выезда с базы; обнулились оба
    // только со стартом следующего задания. Подпись «сессия» обещала бы время текущего выезда.
    time: "Время задания", area: "Площадь задания"
};

// Единицы записаны буквами: хаб вырезает из имени сервиса знаки препинания и надстрочные
// символы. Проверено на живом хабе: «:» исчезает, «м²» превращается в «м», «кв.м» — в «квм»,
// «180°» — в «180». Само сравнение имён от этого больше не зависит (см. anthbotSameName),
// но написанное буквами хотя бы доезжает до экрана целиком.
const ANTHBOT_NAME_UNITS = {
    height: " мм", volume: " %", dir: " град", raintime: " ч",
    nestheight: " мм", maparea: " кв м", time: " мин", area: " кв м"
};

// Всё, что хаб может выбросить из имени, выбрасываем и мы — перед сравнением, не в самом имени
const ANTHBOT_NAME_NOISE = /[^0-9A-Za-zА-Яа-яЁё ]+/g;

// Предел длины имени сервиса в хабе. Проверено на живом: «Статус Возвращается на базу status»
// (34 символа) сохранилось как «Статус Возвращается на базу stat» — хвост срезан ровно по 32-му
// символу ВМЕСТЕ с ключом. Ключ стоит последним словом, поэтому такое обрезание делает сервис
// невидимым для сценария: он перестаёт находить его и обновлять — навсегда, до ручного
// переименования. Поэтому значение режем сами, ключ не трогаем.
const ANTHBOT_NAME_MAX = 32;

// Ключи, у которых значение вытесняет подпись: их значения — сами по себе фразы
// («Возвращается на базу», «Нет ошибок»), и подпись перед ними только съедает место.
const ANTHBOT_NAME_VALUE_ONLY = "status error";

/**
 * Собирает имя вида «Высота 70 мм height», укладываясь в предел длины хаба.
 * Жертвуем хвостом значения — ключ остаётся последним словом при любой длине.
 */
function anthbotComposeName(key, value) {
    const tail = " " + key;
    const valueOnly = (" " + ANTHBOT_NAME_VALUE_ONLY + " ").indexOf(" " + key + " ") >= 0;
    const head = valueOnly ? "" : ANTHBOT_NAME_LABELS[key] + " ";
    const body = String(value) + (ANTHBOT_NAME_UNITS[key] || "");

    const room = ANTHBOT_NAME_MAX - head.length - tail.length;
    if (room < 1) {
        return ANTHBOT_NAME_LABELS[key] + tail;
    }
    return head + anthbotTrimToWords(body, room) + tail;
}

/**
 * Режет строку до предела, по возможности по границе слова: «Нет связи не заполнены»
 * читается, «Нет связи не заполнены л» — нет. Если слово одно (например SSID), режем как есть.
 */
function anthbotTrimToWords(text, limit) {
    if (text.length <= limit) {
        return text;
    }
    const cut = text.substring(0, limit);
    const space = cut.lastIndexOf(" ");
    return space >= Math.floor(limit / 2) ? cut.substring(0, space) : cut;
}

/**
 * Сравнивает имя сервиса с ожидаемым, не замечая символов, которые хаб вырезает сам.
 *
 * Без этого сценарий попадает в вечный цикл переименования: он ставит «507 кв.м maparea»,
 * хаб сохраняет «507 квм maparea», на следующем опросе имена «не совпадают» — и так каждую минуту.
 */
function anthbotSameName(actual, expected) {
    const clean = function (name) {
        return String(name).replace(ANTHBOT_NAME_NOISE, " ")
            .replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    };
    return clean(actual) === clean(expected);
}

/**
 * Выносит значение в название сервиса: «Статус: На зарядке status».
 *
 * Хаб показывает на рабочем столе значения только «измерительных» сервисов и выключателей;
 * у сервиса «Параметр» плитка остаётся пустой, а значение видно лишь в карточке устройства.
 * Название же видно всегда — поэтому значение пишется туда. Ключ остаётся последним словом,
 * так что привязка сервисов не ломается.
 *
 * Скрытым с рабочего стола сервисам, наоборот, возвращаем чистое название: плитки у них нет,
 * а в карточке значение и так стоит рядом с именем — застрявшее в имени старое значение
 * («Карта idle mapstate», когда робот уже косит) там только путает.
 */
function anthbotApplyValueNames(services, options) {
    if (options.valueInName === false) {
        // Опция выключена — имена целиком на совести владельца хаба, не трогаем никакие
        return;
    }

    for (const key in ANTHBOT_NAME_LABELS) {
        if (!ANTHBOT_NAME_LABELS.hasOwnProperty(key)) {
            continue;
        }
        const service = services[key];
        if (!service) {
            continue;
        }

        let expected = ANTHBOT_NAME_LABELS[key] + " " + key;
        if (service.isVisible()) {
            const characteristic = anthbotValueCharacteristic(service);
            const value = characteristic ? characteristic.getValue() : null;
            if (value === null || value === undefined || value === "") {
                // Значения ещё нет (первый опрос не прошёл) — не сбрасываем то, что уже стоит
                continue;
            }
            expected = anthbotComposeName(key, value);
        }

        if (!anthbotSameName(service.getName(), expected)) {
            service.setName(expected);
        }
    }
}

/**
 * Строка статуса для карточки устройства: состояние плюс признак недоступности.
 */
function anthbotStatusLine(state) {
    if (state.online === false) {
        return "Недоступна (нет связи с облаком)";
    }
    return state.statusText;
}

function anthbotApplyBattery(service, state, variables) {
    if (!service || state.battery === null) {
        return;
    }
    anthbotWrite(anthbotSafeCharacteristic(service, HC.BatteryLevel), state.battery, variables);
    anthbotWrite(anthbotSafeCharacteristic(service, HC.ChargingState), state.charging ? 1 : 0, variables);
    anthbotWrite(anthbotSafeCharacteristic(service, HC.StatusLowBattery), state.battery <= 20 ? 1 : 0, variables);
}

/**
 * Подписывает кнопки зон реальными именами из разметки участка и прячет лишние.
 * Сценарий не может создавать сервисы, поэтому кнопки создаются заранее с запасом.
 */
function anthbotApplyZoneNames(services, variables) {
    anthbotApplyZoneNamesFor(services, variables.zones, "zone", "Зона");
    anthbotApplyZoneNamesFor(services, variables.autoZones, "azone", "Авто-зона");
}

function anthbotApplyZoneNamesFor(services, zones, prefix, label) {
    for (let index = 1; index <= 16; index++) {
        const service = services[prefix + index];
        if (!service) {
            continue;
        }
        const zone = zones[index - 1];
        if (!zone) {
            service.setVisible(false);
            continue;
        }
        service.setVisible(true);
        // Ключ остаётся последним словом имени — иначе сценарий перестанет узнавать сервис.
        // Скобки не ставим: хаб их вырезает, и имя расходилось бы с ожидаемым на каждом опросе.
        // Длинное имя зоны режем сами: хаб обрезает по ANTHBOT_NAME_MAX и съел бы ключ.
        const key = prefix + index;
        const room = ANTHBOT_NAME_MAX - key.length - 1;
        const expectedName = String(zone.name).substring(0, Math.max(1, room)) + " " + key;
        if (!anthbotSameName(service.getName(), expectedName)) {
            service.setName(expectedName);
        }
    }
}

function anthbotSecondsToHours(seconds) {
    return seconds === null || seconds === undefined ? null : Math.round(seconds / 3600);
}

function anthbotSecondsToMinutes(seconds) {
    return seconds === null || seconds === undefined ? null : Math.round(seconds / 60);
}

/**
 * Сверяет отправленную настройку с тем, что косилка вернула следующим опросом.
 *
 * Форма команд восстановлена реверсом и для каждой модели может отличаться. Молча принятая,
 * но не применённая настройка — худший исход: в хабе значение одно, в косилке другое.
 * Поэтому расхождение попадает в лог явно.
 */
function anthbotVerifyPending(state, variables) {
    const pending = variables.pending;
    if (!pending) {
        return;
    }
    if (anthbotNowMs() - pending.atMs < 1000) {
        return;
    }

    const actual = anthbotStateValueForKey(pending.key, state);
    variables.pending = null;
    if (actual === undefined || actual === null || actual === pending.value) {
        return;
    }
    console.warn("[Anthbot] косилка не подтвердила настройку [" + pending.key + "]: отправили " +
        pending.value + ", вернулось " + actual +
        ". Для этой модели может требоваться другой формат команды");
}

// Настройки, применение которых косилка обязана подтвердить в ближайшем состоянии.
// Кошение, база и зоны сюда не входят: они меняют состояние не мгновенно.
const ANTHBOT_VERIFIABLE_KEYS =
    "height volume dir dirauto rain raintime nest nestcount nestheight nestcheck nestlevel";

function anthbotIsVerifiableKey(key) {
    return (" " + ANTHBOT_VERIFIABLE_KEYS + " ").indexOf(" " + key + " ") >= 0;
}

/**
 * Значение настройки в терминах характеристики хаба. undefined — настройку не проверяем.
 */
function anthbotStateValueForKey(key, state) {
    if (key === "height") return state.cutterHeight;
    if (key === "volume") return state.volume;
    if (key === "dir") return state.mowDirection;
    if (key === "dirauto") return state.customDirection;
    if (key === "rain") return state.rainEnabled;
    if (key === "raintime") return anthbotSecondsToHours(state.rainContinueTime);
    if (key === "nest") return state.nestEnabled;
    if (key === "nestcount") return state.nestMowCount;
    if (key === "nestheight") return state.nestCutterHeight;
    if (key === "nestcheck") return state.nestInspection;
    if (key === "nestlevel") return state.nestInspectionLevel;
    return undefined;
}

function anthbotErrorText(errorCode) {
    if (errorCode === null || errorCode === undefined) {
        return null;
    }
    return errorCode === 0 ? "Нет ошибок" : ("Ошибка " + errorCode);
}

function anthbotAsText(value) {
    return (value === null || value === undefined) ? null : String(value);
}

// ============================================================================
// Характеристики → команды косилке
// ============================================================================

// Обе высоты — газона и у базы — задаёт один и тот же нож
const ANTHBOT_HEIGHT_KEYS = "height nestheight";

/**
 * Возвращает высоту в рабочий диапазон косилки и сразу показывает исправление в хабе.
 *
 * Без записи обратно плитка до следующего опроса показывала бы введённые «100», хотя косилке
 * ушло 70, — то есть врала бы целую минуту.
 */
function anthbotCorrectHeight(key, value, services, variables) {
    if ((" " + ANTHBOT_HEIGHT_KEYS + " ").indexOf(" " + key + " ") < 0) {
        return value;
    }
    const clamped = global.anthbotClampHeight(value);
    if (clamped !== value) {
        anthbotWriteServiceValue(services, key, clamped, variables);
    }
    return clamped;
}

function anthbotHandleUserChange(key, accessory, source, value, variables, options) {
    const services = anthbotServiceMap(accessory);
    const reported = variables.reported || {};

    // Человек тронул зоны — с этой секунды его отметка главнее того, что отдаёт облако.
    // Нажатие «Кошение» выбор расходует: задание ушло, и подсветка снова ведётся облаком.
    if (anthbotIsZoneKey(key)) {
        variables.zoneTouchedAtMs = anthbotNowMs();
    } else if (key === "mow" && value) {
        variables.zoneTouchedAtMs = 0;
    }

    value = anthbotCorrectHeight(key, value, services, variables);
    const commands = anthbotCommandsFor(key, value, reported, variables, services, options);

    if (commands === null) {
        anthbotLog(options, "ключ [" + key + "] команды не требует");
        return;
    }
    if (commands.length === 0) {
        console.warn("[Anthbot] нечего отправлять по ключу [" + key + "]: проверьте разметку зон");
        anthbotResetMomentary(key, services, variables);
        return;
    }

    if (anthbotIsVerifiableKey(key)) {
        variables.pending = { key: key, value: value, atMs: anthbotNowMs() };
    }
    anthbotSendAll(commands, accessory, variables, options);
    anthbotResetMomentary(key, services, variables);
}

/**
 * Превращает изменение характеристики в список команд облаку.
 * null означает «характеристика только для чтения».
 */
function anthbotCommandsFor(key, value, reported, variables, services, options) {
    if (key === "mow") {
        return value ? anthbotStartMowingCommands(services, variables, options)
                     : global.anthbotCommandsStop();
    }
    if (key === "dock") {
        return value ? global.anthbotCommandsDock() : [];
    }
    if (key === "refresh") {
        return value ? [global.anthbotCommandRefresh()] : [];
    }
    if (key === "height") {
        return [global.anthbotCommandHeight(value)];
    }
    if (key === "volume") {
        return [global.anthbotCommandVolume(value)];
    }
    if (key === "dir") {
        return [global.anthbotCommandDirection(value, true)];
    }
    if (key === "dirauto") {
        const currentDirection = global.anthbotToInt(global.anthbotGetPath(reported, "param_set.mow_head"));
        return [global.anthbotCommandDirection(currentDirection === null ? 0 : currentDirection, value)];
    }
    if (key === "rain") {
        return [global.anthbotCommandRain(value, global.anthbotToInt(reported.rain_continue_time))];
    }
    if (key === "raintime") {
        const rainEnabled = global.anthbotToBool(reported.rain_switch);
        return [global.anthbotCommandRain(rainEnabled, Math.round(value) * 3600)];
    }
    if (key === "nest") {
        return [global.anthbotCommandNestEnabled(value)];
    }
    if (key === "nestcount") {
        return [global.anthbotCommandNestParams(reported, { mow_count: value })];
    }
    if (key === "nestheight") {
        return [global.anthbotCommandNestParams(reported, { cutter_height: value })];
    }
    if (key === "nestcheck") {
        return [global.anthbotCommandNestParams(reported, { pobctl_switch: value ? 1 : 0 })];
    }
    if (key === "nestlevel") {
        return [global.anthbotCommandNestParams(reported, { pobctl_level: value })];
    }
    // Кнопки зон — не команды, а отметки выбора: команда уходит один раз при старте кошения.
    // Иначе каждое нажатие было бы отдельным заданием, и последнее затирало бы предыдущие —
    // облако принимает список зон только целиком.
    if (anthbotIsZoneKey(key)) {
        return null;
    }
    return null;
}

/**
 * Что делать по нажатию «Кошение»: косить отмеченные зоны или весь газон.
 *
 * @param {Object} services карта «ключ → сервис»
 * @param {Object} variables
 * @param {Object} options
 * @returns {Object[]} список команд
 */
function anthbotStartMowingCommands(services, variables, options) {
    const manual = anthbotSelectedZoneIds(services, variables.zones, "zone");
    if (manual.length > 0) {
        const autoAlso = anthbotSelectedZoneIds(services, variables.autoZones, "azone");
        if (autoAlso.length > 0) {
            console.warn("[Anthbot] отмечены и зоны, и авто-зоны — за одно задание косилка " +
                "принимает что-то одно; кошу отмеченные зоны, авто-зоны пропускаю");
        }
        anthbotLog(options, "кошение зон: " + manual.join(", "));
        return [global.anthbotCommandZoneMow(manual)];
    }

    const autoPoints = anthbotSelectedAutoZonePoints(services, variables.autoZones);
    if (autoPoints.length > 0) {
        anthbotLog(options, "кошение авто-зон: точек " + autoPoints.length);
        return [global.anthbotCommandAutoZoneMow(autoPoints)];
    }

    anthbotLog(options, "зоны не отмечены — кошу весь газон");
    return global.anthbotCommandsStartMowing();
}

/**
 * Идентификаторы отмеченных зон в порядке кнопок.
 */
function anthbotSelectedZoneIds(services, zones, prefix) {
    const selected = [];
    for (let index = 1; index <= 16; index++) {
        const zone = zones[index - 1];
        if (!zone || !anthbotIsZoneSelected(services, prefix + index)) {
            continue;
        }
        selected.push(zone.id);
    }
    return selected;
}

/**
 * Точки отмеченных авто-зон одним списком: облако запускает регион по набору точек.
 */
function anthbotSelectedAutoZonePoints(services, autoZones) {
    let points = [];
    for (let index = 1; index <= 16; index++) {
        const zone = autoZones[index - 1];
        if (!zone || !zone.points || !anthbotIsZoneSelected(services, "azone" + index)) {
            continue;
        }
        points = points.concat(zone.points);
    }
    return points;
}

function anthbotIsZoneSelected(services, key) {
    const characteristic = anthbotValueCharacteristic(services[key]);
    return characteristic !== null && characteristic.getValue() === true;
}

/**
 * Отправляет команды по порядку и просит косилку переопубликовать состояние,
 * чтобы карточка в хабе не ждала следующего планового опроса.
 */
function anthbotSendAll(commands, accessory, variables, options) {
    const session = global.anthbotEnsureSession(variables.session, anthbotConfig(options));
    if (!session.ok) {
        console.warn("[Anthbot] команда не отправлена: " + session.error);
        return;
    }

    for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        const sent = anthbotSendWithRetry(command, variables, options);
        if (!sent.ok) {
            console.warn("[Anthbot] команда " + command.cmd + " не прошла: " + sent.error);
            return;
        }
        anthbotLog(options, "команда " + command.cmd + " принята");
    }

    setTimeout(function () {
        anthbotSendWithRetry(global.anthbotCommandRefresh(), variables, options);
        anthbotPoll(accessory, variables, options);
    }, 1500);
}

function anthbotDelivery(variables, options) {
    return {
        viaShadow: options.commandViaShadow === true,
        topicMode: variables.topicMode || 0
    };
}

function anthbotSendWithRetry(command, variables, options) {
    let result = global.anthbotSendCommand(variables.session, command.cmd, command.data,
        anthbotDelivery(variables, options));
    if (result.ok) {
        return result;
    }

    if (global.anthbotInvalidateSession(variables.session, result.status)) {
        const renewed = global.anthbotEnsureSession(variables.session, anthbotConfig(options));
        if (!renewed.ok) {
            return renewed;
        }
        result = global.anthbotSendCommand(variables.session, command.cmd, command.data,
            anthbotDelivery(variables, options));
        if (result.ok) {
            return result;
        }
    }

    return anthbotRetryWithOtherTopicModes(command, variables, options, result);
}

/**
 * Упорный 403 на публикации в топик — это не всегда протухшие креды.
 *
 * Путь топика едет по проводу закодированным (`%24aws%2F…`), а подпись считается от него же,
 * закодированного второй раз. Если HTTP-клиент хаба нормализует такой путь по-своему, подпись
 * перестаёт сходиться. Перебираем оставшиеся варианты канонизации в порядке
 * ANTHBOT_LOGIC_TOPIC_MODE_ORDER и запоминаем сработавший — чтобы следующие команды шли им сразу,
 * а не тратили круг на заведомо отказной вариант.
 */
function anthbotRetryWithOtherTopicModes(command, variables, options, lastResult) {
    if (lastResult.status !== 403 || options.commandViaShadow) {
        return lastResult;
    }

    for (let index = 0; index < ANTHBOT_LOGIC_TOPIC_MODE_ORDER.length; index++) {
        const mode = ANTHBOT_LOGIC_TOPIC_MODE_ORDER[index];
        if (mode === (variables.topicMode || 0)) {
            continue;
        }
        const attempt = global.anthbotSendCommand(variables.session, command.cmd, command.data,
            { topicMode: mode });
        if (attempt.ok) {
            variables.topicMode = mode;
            console.info("[Anthbot] подпись пути топика: перешёл на вариант " + mode);
            return attempt;
        }
    }
    return lastResult;
}

/**
 * Кнопки-импульсы («на базу», «обновить») возвращаются в выключенное состояние сами:
 * они означают действие, а не состояние. Кнопки зон сюда НЕ входят — они хранят выбор
 * до нажатия «Кошение» и гаснуть не должны.
 */
function anthbotResetMomentary(key, services, variables) {
    if ((" " + ANTHBOT_MOMENTARY_KEYS + " ").indexOf(" " + key + " ") < 0) {
        return;
    }
    const characteristic = anthbotValueCharacteristic(services[key]);
    if (!characteristic || characteristic.getValue() !== true) {
        return;
    }
    setTimeout(function () {
        anthbotWrite(characteristic, false, variables);
    }, ANTHBOT_MOMENTARY_RESET_MS);
}
