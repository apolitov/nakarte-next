# Отправка курса в Garmin Connect без партнёрского Courses API

Справка на 12.11.2026. Ничего не устанавливалось и не запускалось, вход в Garmin не выполнялся. Исходники читались с GitHub. Эндпоинты неофициальные, подтверждены кодом других проектов и записанными ответами, но не проверены вживую в этой работе.

## Коротко

- Рабочий путь: python-garminconnect 0.3.20 (23.10.2026). Курсы в нём есть: `import_course`, `create_course`, `get_course`, `delete_course`, `download_course`.
- Отправка на устройство в этой библиотеке не реализована. Метод есть в Go-клиенте gccli: POST `/device-service/devicemessage/messages` с `messageType: "courses"`.
- Курс, просто созданный через `POST /course-service/course`, появляется в Courses аккаунта. Будет ли он сам уходить на часы без отправки, не подтверждено ничем; руководства Garmin описывают ручную отправку. Надёжнее вызвать send-to-device.
- Официальный Courses API закрыт для новых заявок с весны 2026, срока возобновления нет. Новый «Personal API» только для чтения.
- Рекомендация: python-garminconnect + GPX-импорт + send-to-device, как опция «best effort», с готовым запасным путём «скачать GPX/FIT».

## 1. Библиотеки и вход

| Библиотека | Состояние | Источник |
|---|---|---|
| cyberjunky/python-garminconnect | Жива. 0.3.20 от 23.10.2026, до этого релизы 0.3.13-0.3.19 с 09.09 по 16.10.2026. Требует Python 3.12+, зависимости curl_cffi, requests, ua-generator | [PyPI](https://pypi.org/pypi/garminconnect/json), [релизы](https://api.github.com/repos/cyberjunky/python-garminconnect/releases?per_page=8) |
| matin/garth | Мертва. README: «deprecated and no longer maintained», 0.8.0 последний релиз, новые входы не работают | [PyPI](https://pypi.org/pypi/garth/json), [репозиторий](https://github.com/matin/garth) |
| Pythe1337N/garmin-connect (JS) | Статус не удалось установить: на странице нет релизов и дат, упоминания нового входа нет, курсов в README нет | [репозиторий](https://github.com/Pythe1337N/garmin-connect) |
| @flow-js/garmin-connect (npm) | Страница npm вернула 403, не проверено. По поисковой выдаче умеет создавать курсы с точками, структура полей неизвестна | [npm](https://www.npmjs.com/package/@flow-js/garmin-connect) |
| bpauli/gccli (Go CLI) | Единственный найденный клиент с отправкой курса на устройство, плюс записанные ответы Garmin в `conformance/testdata/recorded/` | [репозиторий](https://github.com/bpauli/gccli) |

### Поломки входа в 2026 и починка

- Март-апрель 2026: Cloudflare на стороне Garmin блокирует мобильный User-Agent garth. Вход падает на 401 `oauth-service/oauth/preauthorized`, местами 429. Ветка [issue #332](https://github.com/cyberjunky/python-garminconnect/issues/332) (открыта 17.03, закрыта 11.04.2026). Исправление: версия 0.3.0 (02.04) убрала garth и перешла на собственный вход; 0.3.2 (11.04) подтверждена пользователями. Мейнтейнер называет ситуацию игрой в кошки-мышки и допускает ужесточение TLS-фингерпринтинга.
- Июнь 2026: токены «widget»-входа принимает сервер авторизации, но отвергает API («Token is not active», 401). [issue #369](https://github.com/cyberjunky/python-garminconnect/issues/369) (02.06-09.07.2026). Ответ: цепочка из нескольких стратегий входа с проверкой токена в API и очистка «отравленного» кэша (0.3.4, 0.3.6).
- Октябрь 2026: 0.3.20 «restores mobile login, which had been returning 429 errors since April» и добавляет завершение MFA в другом процессе ([релизы](https://api.github.com/repos/cyberjunky/python-garminconnect/releases?per_page=8)). Открытые в октябре: [#453](https://github.com/cyberjunky/python-garminconnect/issues?q=453) (429 на первом SSO-запросе без Retry-After), [#444](https://github.com/cyberjunky/python-garminconnect/issues?q=444) (403 на connectapi, обычный `requests` режет Cloudflare, curl_cffi работает). Закрыты 16.10.2026.
- Подтверждение с форума Garmin: [TLS fingerprinting blocks third-party clients](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/433892/tls-fingerprinting-blocks-third-party-clients) (Cloudflare ломает не-браузерные клиенты; ответов от Garmin нет). Отсюда зависимость от curl_cffi.

Вывод: вход ломался минимум трижды за 2026 год. Закладывать, что он сломается ещё, и держать запасной путь.

### Как устроен вход в 0.3.x (по коду)

Файлы: [client/constants.py](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/client/constants.py), [client/sso.py](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/client/sso.py), [client/session.py](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/client/session.py), [client/tokens.py](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/client/tokens.py).

- Это уже не OAuth1/OAuth2 из garth. Каскад из 5 стратегий (мобильный iOS/Android SSO, widget, portal) выдаёт сервисный тикет, тикет обменивается на DI-токены на `https://diauth.garmin.com/di-oauth2-service/oauth/token` (`DI_TOKEN_URL`). Хранятся `di_token`, `di_refresh_token`, `di_client_id` (`dumps()`).
- Access-токен обновляется сам: перед запросом проверяется `exp` JWT (запас 900 с), на 401 тоже происходит обновление (`_refresh_di_token`).
- Срок жизни refresh-токена: в коде и README не указан. Пользователь в #332 пишет, что DI-обновление «keeps sessions alive indefinitely» (слова участника, не Garmin). Для garth срок OAuth1 был около года (README garth). Не подтверждено, закладывать «может умереть в любой момент» и уметь запросить повторный вход.
- MFA: `Garmin(email, password, return_on_mfa=True)` и `login()` возвращает `("needs_mfa", client_state)`; код передаётся `resume_login(client_state, code)`. По README `client_state` содержит cookie сессии, хранить как пароль. Начиная с 0.3.20 `resume_login` можно вызвать из другого процесса и на другом экземпляре (это и нужно веб-бэкенду: запрос 1 принимает пароль, запрос 2 принимает код).
- Хранение: `login(tokenstore=...)` принимает путь или inline-JSON; по умолчанию `~/.garminconnect/garmin_tokens.json` с правами 0600 ([api/base.py](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/api/base.py)). Для сервера: `garmin.client.dumps()` и хранение строки зашифрованной в БД (ключ вне БД). Сессии garth-эпохи не конвертируются, [issue #439](https://github.com/cyberjunky/python-garminconnect/issues?q=439).
- Пароль после входа не нужен и хранить его не надо. Не хранить в логах, `logout()` удаляет только локальный файл и не отзывает токен у Garmin.
- Ретраи в библиотеке только для 5xx и сетевых ошибок; 401, 429 и 4xx сразу выбрасываются ([api/_common.py](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/api/_common.py)). Пауза между шагами входа задана «анти-WAF» 2-20 с (constants.py).

## 2. Создание курса: эндпоинты и тело

Хост `connectapi.garmin.com`. Базовый путь из python-garminconnect: `/course-service/course` ([api/base.py, строка 375](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/api/base.py)). Методы в [api/training.py, строки 277-410](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/api/training.py).

| Действие | Запрос | Источник |
|---|---|---|
| Список | GET `/course-service/course/owner/{displayName}` | training.py `get_courses` |
| Один курс | GET `/course-service/course/{id}` | `get_course` |
| Создать | POST `/course-service/course`, JSON | `create_course` |
| Обновить | PUT `/course-service/course/{id}` | `update_course` |
| Удалить | DELETE `/course-service/course/{id}` | `delete_course` |
| Скачать | GET `.../course/gpx/{id}` или `.../course/fit/{id}/0?elevation=true` | `download_course` |
| Разбор файла | POST `/course-service/course/import`, multipart поле `file` (.gpx/.tcx/.fit) | `import_course` |
| Высоты | POST `/course-service/course/elevation?smoothingEnabled=true`, тело `[[lat,lon,null],...]`, ответ `[[lat,lon,ele],...]` | gccli `courses.elevation` |
| Из активности | GET `/course-service/course/convert/activity/{activityId}` | `convert_activity_to_course` |

Важно: `import` НЕ сохраняет курс. Он разбирает файл в черновик (`courseName`, `geoPoints`, `startPoint`, `sourceTypeId`, `coordinateSystem`; запись в [gccli fixtures](https://raw.githubusercontent.com/bpauli/gccli/main/conformance/testdata/recorded/post_course-service.course.import_200_b752de18.json)), его нужно затем отправить в `POST /course-service/course`. Так делают [gccli `ImportCourse`](https://raw.githubusercontent.com/bpauli/gccli/main/internal/garminapi/courses.go) и [garmin_mcp `upload_course`](https://raw.githubusercontent.com/Taxuspt/garmin_mcp/main/src/garmin_mcp/courses.py). Метод `import_course` из python-garminconnect возвращает именно этот черновик; garmin-cli подтверждает, что результат надо передать в `create_course` и что полный ответ import в качестве тела save даёт HTTP 400 ([PR #134](https://github.com/PatrykPodworski/garmin-cli/pull/134)). В garmin-cli эти методы помечены «not verified live», поэтому опора на gccli и garmin_mcp, у которых есть живые вызовы и записи.

### Тело save (по gccli и garmin_mcp)

gccli отфильтровывает черновик до этих ключей (`courseSaveFields`, [courses.go](https://raw.githubusercontent.com/bpauli/gccli/main/internal/garminapi/courses.go)): `activityTypePk, boundingBox, coordinateSystem, courseLines, courseName, coursePoints, distanceMeter, elapsedSeconds, elevationGainMeter, elevationLossMeter, favorite, geoPoints, hasPaceBand, hasPowerGuide, hasTurnDetectionDisabled, includeLaps, matchedToSegments, openStreetMap, rulePK, sourceTypeId, speedMeterPerSecond, startPoint, userProfilePk`, плюс `coursePrivacy`.

Значения, которые ставят оба клиента:
- `sourceTypeId = 3` (GPX), `coordinateSystem = "WGS84"`, `rulePK = 2` (приватный; 1 публичный; в gccli приватность 4 это группа).
- `startPoint` = первая точка трека.
- `geoPoints`: `{latitude, longitude, elevation}` (в ответе сервера ещё `timestamp`, `distance`). Высоту можно получить через `/course/elevation` или передать 0.0 (так делает garmin_mcp).
- garmin_mcp дополнительно считает `distanceMeter` (haversine), `boundingBox` (center/lowerLeft/upperRight плюс флаги `...IsSet`), `startBearing`, `coursePoints: []`, `hasTurnDetectionDisabled: false`, `includeLaps: false`, `matchedToSegments: false`, `openStreetMap: false`. Описание до 512 символов, дольше сервер отклоняет (комментарий в garmin_mcp).
- Ответ: `courseId`, `distanceMeter`, `elevationGainMeter`, `elevationLossMeter`, `courseType`, `public`, `ownerDisplayName` и т. д. ([fixture](https://raw.githubusercontent.com/bpauli/gccli/main/conformance/testdata/recorded/post_course-service.course_200_9b0ff4f4.json), значения в нём анонимизированы).

`activityTypePk` (gccli [course_types.go](https://raw.githubusercontent.com/bpauli/gccli/main/internal/cmd/course_types.go)): running 1, cycling 2, hiking 3, other 4, mountain_biking 5, trail_running 6, street_running 7, walking 9, road_biking 10, gravel_cycling 143, e_bike_mountain 175, e_bike_fitness 176, ultra_run 181. Сверка: [garmin_mcp PR #435](https://github.com/Taxuspt/garmin_mcp/pull/435) исправил свою таблицу на те же значения (walking 9, road_biking 10, gravel 143, MTB 5, trail 6) по `get_activity_types`. Не ставить walking=4: это «other».

### Лимиты на число точек

Нашёл только косвенные данные, официального числа нет:
- Строка Garmin Connect «This file is too large to be imported as a course» (`course_import_gpx_file_failed`) в [course.properties](https://connect.garmin.com/web-translations/course/course.properties?bust=5.7.4.0): лимит на размер файла есть, число не указано.
- Сторонние статьи: очень длинные курсы (сотни км) в одном импорте могут завершаться по таймауту, автор советует участки 100-150 миль ([trailpeaches](https://trailpeaches.com/2026/08/26/gpx-to-garmin-course-waypoints/)); свыше около 321.9 км все точки курса получают расстояние 0 ([pitstopper](https://pitstopper.net/articles/gpx-waypoints-vs-fit-course-points.html)). Это утверждения третьих сторон, мной не проверены.
- Практика: прореживать трек (например Дугласом-Пейкером до нескольких тысяч точек) и делить длинные маршруты. Конкретный предел нужно подобрать тестом на своём аккаунте.

### Регрессия FIT-импорта (лето 2026)

Отчёт на форуме: курсы, импортированные как FIT, с июля 2026 создаются «битыми», Edge 1040 показывает «Invalid course». Известный хороший импорт был 24.05, проблема с 04.07 ([тема](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/439629/bug-report-garmin-connect-fit-course-import-creates-corrupt-courses-invalid-course-on-device)). Это сообщение пользователя, Garmin причину не подтвердил. TCX-импорт открывается, но теряет course points. GPX в теме не проверялся. Поэтому отправлять GPX (как gccli и garmin_mcp), а не FIT, и проверять на реальном устройстве.

## 3. Отправка на устройство

Эндпоинт (только gccli, [SendCourseToDevice](https://raw.githubusercontent.com/bpauli/gccli/main/internal/garminapi/courses.go) и [devices.go](https://raw.githubusercontent.com/bpauli/gccli/main/internal/garminapi/devices.go), `devices.send-message`):

```
POST /device-service/devicemessage/messages
[{"deviceId": <int>,
  "messageUrl": "course-service/course/fit/<courseId>/<deviceId>?elevation=true",
  "messageType": "courses",
  "messageName": "<имя курса>",
  "groupName": null,
  "priority": 0,
  "fileType": "FIT",
  "metaDataId": <courseId>}]
```

- Тот же формат у отправки тренировки в python-garminconnect (`push_workout_to_device`, [devices.py](https://raw.githubusercontent.com/cyberjunky/python-garminconnect/master/garminconnect/api/devices.py)): `messageType: "workouts"`, `fileType: "FIT"`, `priority: 1`. URL константы: `/device-service/devicemessage/messages` (api/base.py).
- `deviceId`: список устройств `GET /device-service/deviceregistration/devices` (`get_devices()`), последнее использованное `get_device_last_used()["userDeviceId"]`.
- Отмена: DELETE `/device-service/devicemessage/message/{messageID}`, список ожидающих: GET `.../messages` (gccli).
- Ответ содержит `messageId`, `deviceName` (gccli парсит так).
- Ограничение: это очередь на сервере Garmin. Курс появится на часах только после следующей синхронизации (Bluetooth/Wi-Fi/Garmin Express). Issue garmin-cli [#132](https://github.com/PatrykPodworski/garmin-cli/issues/132) требует считать успехом именно появление на часах, а не HTTP 200 (закрыт 07.11.2026 PR #135, код не читал).
- Реально ли без send-to-device курс уходит на часы сам: документированного подтверждения нет. По руководствам Garmin отправка делается вручную кнопкой «Send to Device» ([руководство](https://www8.garmin.com/manuals/webhelp/GUID-EA4C028F-6CC0-4957-9BB2-20B2E5DAE9CD/EN-US/GUID-5613803C-5BEB-4EC8-A267-1AF59665F9A3.html)). Считать, что без вызова курс остаётся в библиотеке Connect.

## 4. Чекпоинты курса (course points)

Что подтверждено:
- Тип по FIT-справочнику и словарю Connect ([course.properties](https://connect.garmin.com/web-translations/course/course.properties?bust=5.7.4.0)) включает Water, Food, Summit, Danger, First Aid, Generic Point, Overlook, Campsite, Toilet, Store, Shelter, Checkpoint, Aid Station, Sharp Curve, Steep Incline, Energy Gel, Sports Drink и ещё около 30 (всего около 50). Это подписи, а не ключи JSON.
- В ответе GET курса точки лежат в `coursePoints` с полями `name`, `pointType`, `lat`, `lon`, `distance` (метры от старта) ([garmin_mcp courses.py, строки 255-265](https://raw.githubusercontent.com/Taxuspt/garmin_mcp/main/src/garmin_mcp/courses.py)). `coursePoints` может быть `null` ([issue #377](https://github.com/Taxuspt/garmin_mcp/issues/377)).
- DynamicsNinja/garminconnect-js принимает `coursePoints` при создании (описание на [glama](https://glama.ai/mcp/servers/DynamicsNinja/garminconnect-js/tools/create_course)), но точная схема там не показана.

Что НЕ нашёл: проверенный пример записи `coursePoints` в теле POST (допустимые значения `pointType` как ключи, например `WATER` или `water`). И gccli, и garmin_mcp при создании курса ставят `coursePoints: []` или не передают. Нужно снять запрос из веб-интерфейса Connect (DevTools, создание точки типа Water) или создать курс с точками в UI, затем прочитать `get_course` и скопировать структуру.

Варианты, если «ручками» не получится:
- GPX `<wpt>`: по сторонним статьям Connect при импорте waypoint-ы часто теряет или не привязывает к дистанции (waypoint дальше около 40 м от трека может быть тихо отброшен, [pitstopper](https://pitstopper.net/articles/gpx-waypoints-vs-fit-course-points.html); [trailpeaches](https://trailpeaches.com/2026/08/26/gpx-to-garmin-course-waypoints/)). Сторонние данные, не проверено мной.
- TCX с `<CoursePoint>` (Name, Time, Position, PointType, Notes) импортируется и сохраняет точки, по тем же статьям, но TCX-импорт для вашего кейса не проверен.
- Лимиты по устройствам из тех же статей: 50 точек на старых, 200 на Fenix 5 и новее. Имена коротить.

## 5. Риски

- Бан аккаунта: подтверждений бана за неофициальный API не нашёл (поиск по форуму и issues). Нашёл блокировки входа: форум Garmin, [429 на всех входах API более 48 часов](https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours), при этом веб и приложение работали. Документация одной из библиотек советует ждать 1-24 часа.
- Капча: 0.3.5 научилась распознавать Cloudflare 403 и CAPTCHA (по описанию релиза на [newreleases](https://newreleases.io/project/github/cyberjunky/python-garminconnect/release/0.3.5)); обходить капчу нельзя, показывать пользователю ошибку.
- Rate limit: входов минимум, повторять вход только вручную. Токен кэшировать, вход не делать на каждый запрос. Для вызовов API порог не опубликован.
- IP: Cloudflare часто режет серверные IP (мейнтейнер: прокси «often blocked»). Вход с VPS в дата-центре рискованнее, чем с домашнего IP. Запасной вариант: получить токены локально и перенести на VPS (после входа достаточно refresh, но Cloudflare может резать и его, не проверено).
- ToS: текст условий использования Garmin Connect не читал, утверждения нет. Неофициальный доступ вне программы разработчиков с высокой вероятностью им не разрешён; разумно считать риском отключения доступа. Для проекта «один пользователь, свой аккаунт» риск в основном техническая хрупкость.
- Как делают сервисы-конвертеры: крупные сервисы, по логике Courses API, должны работать через партнёрскую программу (в источниках не подтверждено по именам). Найденные малые инструменты (GPX→TCX-конвертеры из статей trailpeaches и pitstopper) выдают пользователю файл для ручного импорта в Connect. Прямых источников о том, как именно делают конкретные сервисы, нет.
- Токены пользователя на VPS равны доступу ко всему аккаунту Garmin (здоровье, активности). Шифровать, давать пользователю кнопку «отозвать».

## 6. Официальный путь

- [Courses API](https://developer.garmin.com/gc-developer-program/enterprise/courses-api/): публикует курсы в Connect, синхронизация идёт на устройства, формат полезной нагрузки на странице не описан. Заявка через форму; на [обзорной странице программы](https://developer.garmin.com/gc-developer-program/overview/) Courses входит в Starter и Enterprise; индивидуальные разработчики и стартапы допускаются в «Business».
- Фактическое состояние: [the5krunner, 14.09.2026](https://the5krunner.com/2026/09/14/garmin-developer-api-access-paused/) и [Terra](https://tryterra.co/blog/garmin-connect-developer-program-pause): приём новых заявок на все облачные API (в том числе Courses) приостановлен «на время обновления программы», форма снята, заявка с марта оставалась без решения на 11.09.2026, даты возобновления нет. Существующие партнёры работают. Условий для частного лица не нашёл (страница FAQ вернула 404).
- Новый «Personal API» ([issue #476](https://github.com/cyberjunky/python-garminconnect/issues/476), 21-23.10.2026): только чтение, push-доступа нет, поэтому курс не отправить. Официальный клиент: github.com/garmin/connect-personal-api-python (по ссылке из issue, не открывал).

## Рекомендация

1. Не строить архитектуру на неофициальном доступе как на единственном пути. Основной сценарий: кнопка «Скачать GPX/FIT» (и импорт вручную в Connect/Garmin Express), это работает всегда.
2. Опция «Отправить в Garmin» через python-garminconnect 0.3.20 с пометкой «экспериментально»: GPX-импорт, save, send-to-device. Пользователь один, вход один раз, токены (`client.dumps()`) шифрованные в БД. Вход делать по запросу пользователя, с прямой кнопкой повторного входа и понятной ошибкой при 429/403.
3. Закрепить версию библиотеки, следить за релизами (вход ломали в марте, июне, октябре).
4. Перед релизом проверить на реальном аккаунте и устройстве: (а) GPX сохраняется и открывается на часах, (б) предел точек и длины, (в) схема `coursePoints` в POST, (г) нужен ли send-to-device. Это четыре непроверенных места этой справки.
5. Следить за возобновлением официальной программы; при появлении доступа перейти на Courses API.

## Минимальный пример (не запускался)

Собран по коду python-garminconnect 0.3.20 (`import_course`, `create_course`, `client.post`, `client.dumps`) и gccli (`ImportCourse`, `SendCourseToDevice`). Поля и значения взяты из тех же файлов, но на живом аккаунте не проверены. Обратите внимание: `import_course` принимает путь к файлу, поэтому GPX сначала пишется во временный файл; результат import в `create_course` целиком передавать нельзя (HTTP 400), поэтому тело собирается заново.

```python
# pip install garminconnect==0.3.20   (Python 3.12+)
import math, tempfile, os
from garminconnect import Garmin

ACTIVITY = {"cycling": 2, "road_biking": 10, "gravel_cycling": 143,
            "mountain_biking": 5, "hiking": 3, "walking": 9, "running": 1}
SAVE_KEYS = ("activityTypePk", "boundingBox", "coordinateSystem", "courseLines",
             "courseName", "coursePoints", "distanceMeter", "elapsedSeconds",
             "elevationGainMeter", "elevationLossMeter", "geoPoints", "includeLaps",
             "matchedToSegments", "openStreetMap", "rulePK", "sourceTypeId",
             "startPoint", "hasTurnDetectionDisabled")


# --- вход: два HTTP-запроса бэкенда --------------------------------------
def login_step1(email, password):
    g = Garmin(email, password, return_on_mfa=True)
    status, state = g.login()            # ("needs_mfa", state) или (None, None)
    if status == "needs_mfa":
        return g, state                  # state хранить как пароль
    return g, None

def login_step2(email, password, state, code):
    g = Garmin(email, password, return_on_mfa=True)
    g.resume_login(state, code)          # 0.3.20: можно в другом процессе
    return g

def dump_tokens(g) -> str:               # шифровать и класть в БД
    return g.client.dumps()

def from_tokens(blob: str) -> Garmin:
    g = Garmin()
    g.login(tokenstore=blob)             # inline JSON поддерживается
    return g


# --- курс ----------------------------------------------------------------
def haversine(a, b):
    r = 6371000
    p1, p2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dl = math.radians(b["longitude"] - a["longitude"])
    dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))

def upload_gpx(g: Garmin, gpx_text: str, name: str, kind="road_biking") -> dict:
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "route.gpx")
        with open(path, "w", encoding="utf-8") as f:
            f.write(gpx_text)
        draft = g.import_course(path)    # POST /course-service/course/import

    pts = draft["geoPoints"]
    if len(pts) < 2:
        raise ValueError("нужно минимум 2 точки")
    for p in pts:
        if p.get("elevation") is None:
            p["elevation"] = 0.0         # или POST /course/elevation
    lats = [p["latitude"] for p in pts]
    lons = [p["longitude"] for p in pts]
    body = {
        "courseName": name,
        "activityTypePk": ACTIVITY[kind],
        "rulePK": 2,                     # приватный
        "sourceTypeId": 3,
        "coordinateSystem": "WGS84",
        "startPoint": pts[0],
        "geoPoints": pts,
        "coursePoints": [],              # схема записи чекпоинтов не проверена
        "distanceMeter": sum(haversine(pts[i - 1], pts[i]) for i in range(1, len(pts))),
        "elevationGainMeter": 0.0,
        "elevationLossMeter": 0.0,
        "boundingBox": {
            "center": {"latitude": (min(lats) + max(lats)) / 2,
                       "longitude": (min(lons) + max(lons)) / 2},
            "lowerLeft": {"latitude": min(lats), "longitude": min(lons)},
            "upperRight": {"latitude": max(lats), "longitude": max(lons)},
            "lowerLeftLatIsSet": True, "lowerLeftLongIsSet": True,
            "upperRightLatIsSet": True, "upperRightLongIsSet": True},
        "openStreetMap": False, "matchedToSegments": False,
        "includeLaps": False, "hasTurnDetectionDisabled": False,
    }
    body = {k: v for k, v in body.items() if k in SAVE_KEYS}
    return g.create_course(body)         # POST /course-service/course


def send_to_device(g: Garmin, course_id: int, name: str, device_id: int | None = None):
    """Эндпоинт из gccli SendCourseToDevice; в python-garminconnect метода нет."""
    if device_id is None:
        device_id = g.get_device_last_used()["userDeviceId"]
    payload = [{
        "deviceId": device_id,
        "messageUrl": f"course-service/course/fit/{course_id}/{device_id}?elevation=true",
        "messageType": "courses",
        "messageName": name,
        "groupName": None,
        "priority": 0,
        "fileType": "FIT",
        "metaDataId": course_id,
    }]
    return g.client.post("connectapi", g.garmin_connect_devicemessage_url,
                         json=payload, api=True)

# saved = upload_gpx(g, gpx, "Тест", "road_biking")
# send_to_device(g, saved["courseId"], "Тест")
```

В FastAPI синхронные вызовы библиотеки вынести в `run_in_threadpool`, на один аккаунт делать не больше одного параллельного запроса.

## Что не нашёл

- Официальный лимит числа точек/размера файла для `course-service`.
- Схему записи `coursePoints` в теле POST (допустимые `pointType`).
- Срок жизни DI refresh-токена.
- Текст ToS Garmin Connect о неофициальном доступе.
- Исходники отправки курса в garmin-cli PR #135 (читал только описание) и состояние JS-библиотек.
- Подтверждение, что курс без send-to-device сам уходит на часы.
