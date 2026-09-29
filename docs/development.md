# Разработка и сборка

## Окружение

Node.js 24 LTS, npm, Windows или macOS. Проверенное окружение этой реализации: Windows, Node 24.21.0. Версии зависимостей закреплены в `package-lock.json`; OpenType.js дополнительно закреплён точно на 1.3.4 из-за проверенной несовместимости 2.0.0 с Noto.

```sh
npm ci
npm run setup:electron
npm run dev
```

`setup:electron` нужен, если политика npm запрещает install scripts. Он загружает runtime Electron. Сеть нужна для первой установки npm-зависимостей/инструментов сборки; готовое приложение и все пользовательские функции работают локально. Dev использует только localhost:5173, который закрывается вместе с Electron. Изменения main/preload требуют перезапуска dev.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm start` запускает последнюю сборку. Если в окружении установлен `ELECTRON_RUN_AS_NODE`, удалите его для запуска Electron (dev-скрипт делает это сам).

## Desktop-проверки

```sh
npm run build
npm run test:desktop
npm run test:interactions
npm run test:recovery
npm run test:exports
node tests/performance.mjs
```

Первый desktop-прогон создаёт `artifacts/acceptance.axon`, `roundtrip.axon`, `stress.axon`, PNG/SVG/PDF и снимки окна. Последующие проверки используют эти fixtures. Они не загружаются в стартовый документ продукта и не становятся шаблонами UI.

Тесты запускают настоящее окно Electron, но детерминированно подменяют **ответы нативных диалогов**. Реальные IPC, validation, filesystem и clipboard выполняются. Test-only launcher восстановления живёт в `tests/`, в дистрибутив не входит. Изолированный userData задаётся `AXON_TEST_DATA`, обычные пользовательские данные не затрагиваются. Тесты меняют системный clipboard тестовым содержимым.

PDF дополнительно растеризуется через независимый PDF.js. SVG открывается в установленном Microsoft Edge (Playwright `channel: msedge`); проверяется реальное отображение встроенного изображения. `@napi-rs/canvas` читает пиксели PNG и проверяет размеры/прозрачность. Эти инструменты — только devDependencies. Встроенный SVG-loader Skia в этой среде не отображал embedded PNG, поэтому не используется как подтверждение изображения; файлы проверены в Edge. Проверка экспортов не заявляет совместимость со всеми сторонними редакторами.

Дополнительные команды: `node tests/close.mjs` (закрытие/ошибка записи), `node tests/dev-smoke.mjs` (dev), `node tests/packaged.mjs` (распакованный Windows binary). Экспортный тест требует установленный Edge; для другой среды задайте подходящий установленный Chromium channel в тестовом скрипте. Production не зависит от Edge/PDF.js.

## Дистрибутивы

```sh
npm run package:win
npm run dist:win
npm run dist:mac
```

- Windows: `release/win-unpacked/Axon.exe`; NSIS installer `release/Axon Setup 0.1.0.exe`.
- macOS: DMG/ZIP в `release/`; сборку выполнять на macOS после `npm ci` и загрузки правильного Electron runtime.
- `electronDist` указывает на локальный `node_modules/electron/dist`; не копируйте Windows runtime на Mac.
- Подпись Windows, Developer ID и notarization macOS требуют учётных данных. Конфигурация macOS unsigned (`identity: null`); ни подпись, ни notarization не выполнены.

Иконки: `node scripts/make-icon.mjs` (затем копия `build/icon.png` в `public/icon.png`). Лицензии: `node scripts/notices.mjs`. Реальные статусы упаковки и запуска указаны в `verification.md`.

## Данные

Обычный Electron userData:

- Windows: `%APPDATA%/Axon/`.
- macOS: `~/Library/Application Support/Axon/`.

`settings.json` — тема, сетка, привязки, reduced motion, восстановление, последние стили, до восьми последних файлов. `recovery.json` — последняя успешно записанная рабочая копия, путь, сохранённое содержимое и время. `.axon` хранится в выбранном пользователем месте. История undo только в памяти. Все шрифты и UI-ресурсы находятся внутри дистрибутива.

## Ограничения среды и диагностика

В ограниченной песочнице Windows Vite/Vitest могут завершаться с `spawn EPERM`; нужен разрешённый запуск локальных дочерних процессов. Это ограничение среды проверки, не специальный режим продукта. При включённом npm offline first install может выдавать `ENOTCACHED`; разрешите обычный доступ к npm registry для установки. Для штатного запуска сетевой доступ не требуется.

Native Computer Use в этой сессии недоступен: `failed to connect native pipe`, Windows error 2. Снимки сделаны через Electron/Playwright и осмотрены отдельно. macOS, реальные жесты физического трекпада, реальная смена DPI между мониторами и подписанные установщики требуют отдельного оборудования/учётных данных.

Для Vite исключены `artifacts`, release и кэши, чтобы watcher не пытался открыть заблокированные служебные файлы Electron. Только локальный dev HTML разрешает inline HMR preamble; production CSP остаётся `script-src 'self'`. IPC URL сравнивается в нормализованном виде.
