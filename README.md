# Anthbot Genie → Sprut.Hub

Интеграция роботов-газонокосилок **Anthbot Genie** в умный дом **Sprut.Hub** — без Home Assistant,
без внешних мостов и сервисов: вся работа с облаком Anthbot идёт внутри сценария хаба.

Основано на реверсе облачного API из проекта
[vincentjanv/anthbot_genie_ha](https://github.com/vincentjanv/anthbot_genie_ha) (интеграция для Home Assistant).
Неофициальный любительский проект, с Anthbot никак не связан.

## Что внутри

| Путь | Что это |
|---|---|
| [AnthbotGenie/](AnthbotGenie/) | сценарий для Sprut.Hub: глобальный (библиотека) + логический |
| [AnthbotGenie/source/AnthbotGenie.Global.js](AnthbotGenie/source/AnthbotGenie.Global.js) | крипто (MD5/SHA-256/HMAC), подпись AWS SigV4, клиент облака Anthbot |
| [AnthbotGenie/source/AnthbotGenie.Logic.js](AnthbotGenie/source/AnthbotGenie.Logic.js) | логический сценарий: опрос, маппинг характеристик, команды |
| [AnthbotGenie/README.md](AnthbotGenie/README.md) | инструкция: какой виртуальный аксессуар создать и как настроить |

> **Перед заливкой в хаб уберите из сценариев комментарии.** Sprut.Hub молча не сохраняет
> крупные сценарии: исходник с документацией (≈60 КБ) не доезжает — интерфейс не показывает
> ошибку, сценарий просто остаётся пустым. Комментарии здесь занимают больше половины объёма,
> и без них код укладывается в предел. Вырезать их нужно по AST (например `acorn`), а не
> регулярками: в коде есть регулярные литералы вида `/^https?:\/\//i`, на которых
> «убрать всё после `//`» ломает программу.

## Как это работает

Локального протокола у косилки нет — приложение ходит в облако, поэтому и хаб ходит туда же:

1. логин на `api.anthbot.com` → bearer-токен;
2. список привязанных косилок, регион и AWS IoT endpoint устройства;
3. временные AWS-креды под конкретный серийник (`/iot/sts/arn`);
4. чтение состояния — `GET https://<endpoint>/things/<sn>/shadow?name=property` с подписью **AWS SigV4**;
5. команды — публикация в топик: `POST https://<endpoint>/topics/$aws/things/<sn>/shadow/name/service/update`
   с телом `{"state":{"desired":{"cmd":…,"data":…}}}`.

Именно публикация в топик, а не документированный `UpdateThingShadow`: на Genie 800 запись в
shadow облако принимает (HTTP 200), но косилка её не исполняет — прошивка слушает сам топик, а не
дельту shadow. Путь через `UpdateThingShadow` оставлен опцией сценария для других моделей.

В песочнице сценариев Sprut.Hub нет крипто-API и Java-классов, поэтому MD5, SHA-256 и HMAC-SHA256
реализованы на чистом ES5 внутри глобального сценария.

## Тесты

Тесты (167 штук) лежат в `AnthbotGenie/.tests/`. Раннер — `ScenarioSimulator` из репозитория
[Sprut.Hub_Tools](https://github.com/BOOMikru/Sprut.Hub_Tools); склонируйте его отдельно и
запустите, указав корень этого проекта:

```bash
bun run cli run AnthbotGenie --root /путь/к/anthbot_genie_sprut
```

## Безопасность

Логин и пароль Anthbot вводятся в опциях сценария в хабе и **никогда** не попадают в этот
репозиторий. Статические AWS-ключи, зашитые в референсной HA-интеграции, здесь не используются —
только временные креды из `/iot/sts/arn`, ограниченные одним серийником.
