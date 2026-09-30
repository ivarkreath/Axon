# Разработка и сборка

## Окружение

Node.js 24, npm, Windows или macOS. Workflow macOS использует Node.js 24. Версии зависимостей закреплены в `package-lock.json`; OpenType.js дополнительно закреплён точно на 1.3.4 из-за несовместимости 2.0.0 с Noto.

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

`npm start` запускает development runtime Electron с последними dist/dist-electron. Это проверка исходников, а пользовательское production-приложение находится по постоянному пути ниже. Если в окружении установлен `ELECTRON_RUN_AS_NODE`, удалите его для запуска Electron (dev-скрипт делает это сам).

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

PDF дополнительно растеризуется через независимый PDF.js. SVG открывается в установленном Microsoft Edge (Playwright `channel: msedge`); проверяется реальное отображение встроенного изображения. `@napi-rs/canvas` читает пиксели PNG и проверяет размеры/прозрачность. Эти инструменты — только devDependencies. Проверка экспортов не заявляет совместимость со всеми сторонними редакторами.

Дополнительные команды: `node tests/close.mjs` (закрытие/ошибка записи), `node tests/dev-smoke.mjs` (dev), `node tests/packaged.mjs` (распакованный Windows binary). Экспортный тест требует установленный Edge; для другой среды задайте подходящий установленный Chromium channel в тестовом скрипте. Production не зависит от Edge/PDF.js.

## Дистрибутивы

```sh
npm run dist:win
npm run dist:mac
```

- Windows x64: production-команда `npm run dist:win`; запуск `release/win-unpacked/Axon.exe`. `package:win` — alias этой же команды. Pipeline создаёт папку приложения без установщика; EXE нужно хранить вместе с остальными файлами комплекта.
- macOS: DMG/ZIP в `release/`; сборку выполнять на macOS после `npm ci` и загрузки правильного Electron runtime.
- `electronDist` указывает на локальный `node_modules/electron/dist`; не копируйте Windows runtime на Mac.
- Подпись Windows, Developer ID и notarization macOS требуют учётных данных. Для macOS настроена локальная подпись ad-hoc (`identity: "-"`); она не подтверждает разработчика через Apple и не заменяет notarization.

`scripts/publish-windows.mjs` использует текущий electron-builder, appId `app.axon.desktop`, productName `Axon`, runtime и обычный userData без изменений. Выполняются lint, все unit-тесты, build (включая typecheck), упаковка во внутреннюю `release/.windows-build/stage`, аудит ASAR и реальный запуск staging EXE с тестовым профилем. В ASAR запрещены локальные агентские файлы, тесты, документы пользователя, recovery и секреты. Перед заменой проверяется, что канонический Axon не запущен. Каталоги должны находиться внутри release и не быть ссылками.

Успешно подготовленный комплект заменяет всю `release/win-unpacked` переименованием каталогов на том же диске. Предыдущий комплект временно хранится в служебном `release/.windows-build/previous`; при ошибке замены/проверки запуска возвращается на постоянный путь. После успешного запуска именно канонического EXE предыдущий комплект удаляется. `build-info.json` хранит время, команду и SHA-256 app.asar. Тест запуска использует отдельный AXON_TEST_DATA и не меняет обычные настройки/вкладки. Ошибка отката явно сообщает путь сохранённого предыдущего комплекта; при наличии unresolved previous новая публикация запрещена.

Перед заменой перечисляются файлы старого комплекта: пользовательские .axon/изображения/экспорты и неизвестные дополнительные файлы блокируют публикацию до их переноса владельцем. Скрипт не удаляет их вместе с предыдущей версией. Тесты зависимостей явно исключены из build.files; аудит проверяет и ASAR, и внешние файлы. CLI использует `--publish never` и не публикует сборку в интернете.

При следующем обновлении сохраните работу, закройте Axon и выполните из корня `npm run dist:win`. Дождитесь `UPDATED AND LAUNCHED`, затем используйте тот же EXE или ярлык на него. При занятых файлах нет принудительного kill или альтернативного пользовательского EXE: устраните указанную причину и повторите команду. Не создавайте соседние test/fixed/new/versioned приложения и не копируйте отдельно EXE без ресурсов. DLL, locales, ресурсы и helper-файлы — части одного приложения. Документы, рабочая папка и userData не очищаются.

### macOS CI/CD

Workflow `.github/workflows/macos-release.yml` автоматически запускается при push в `main`, `test`, `develope` и pull request в `main`. Он собирает DMG/ZIP на отдельных macOS-runner: `macos-15` для arm64 и `macos-15-intel` для x64. Выполняются typecheck, lint, unit-тесты, проверка DMG, аудит содержимого обоих пакетов, сравнение app.asar, проверка подписи и запуск распакованного `Axon.app` через `tests/mac-packaged.mjs`. Файлы доступны в Actions → запуск → Artifacts (`macos-release-arm64`, `macos-release-x64`) 14 дней. Журналы и снимки сохраняются отдельно.

Публикация постоянных ссылок в GitHub Releases:

1. Согласуйте `version` в `package.json` и корне `package-lock.json` с версией выпуска.
2. Отправьте новый тег: `git tag v2.0.0-macos`, затем `git push origin v2.0.0-macos`. Также поддерживаются теги без `v`, например `2.0.1`.
3. Либо выберите **Actions → macOS CI and release → Run workflow**, нужную ветку и новый `release_tag`. Пустой тег означает только сборку без публикации.

Тег должен совпадать с версией пакета, допускается суффикс вроде `-macos`. Только после успеха обеих архитектур создаётся draft с четырьмя файлами и `SHA256SUMS.txt`, затем открывается как prerelease. Существующие релизы не изменяются; для повторного выпуска нужен новый тег. В описании сохраняются версия, commit и ссылка на проверивший их запуск. Если загрузка прервалась после создания draft, он остаётся для проверки владельцем, автоматического перезаписывания нет.

Дополнительные GitHub secrets не нужны: право `contents: write` выдаётся только задаче публикации, сборки используют `contents: read`. Подпись остаётся ad-hoc; для Developer ID и notarization нужен отдельный сертификат Apple и настройка подписания. Инструкция установки и первого запуска: [описание macOS-релиза](releases/macos.md). Для локальной проверки пакетов после сборки на Mac: `node tests/mac-packaged.mjs`.

Иконки: `node scripts/make-icon.mjs` (затем копия `build/icon.png` в `public/icon.png`). Лицензии: `node scripts/notices.mjs`.

## Данные

Обычный Electron userData:

- Windows: `%APPDATA%/Axon/`.
- macOS: `~/Library/Application Support/Axon/`.

`settings.json` — тема, сетка, привязки, reduced motion, восстановление, последние стили, до восьми последних файлов. `recovery.json` — последняя успешно записанная рабочая копия, путь, сохранённое содержимое и время. `.axon` хранится в выбранном пользователем месте. История undo только в памяти. Все шрифты и UI-ресурсы находятся внутри дистрибутива.

## Ограничения среды и диагностика

В ограниченной песочнице Windows Vite/Vitest могут завершаться с `spawn EPERM`; нужен разрешённый запуск локальных дочерних процессов. Это ограничение среды проверки, не специальный режим продукта. При включённом npm offline first install может выдавать `ENOTCACHED`; разрешите обычный доступ к npm registry для установки. Для штатного запуска сетевой доступ не требуется.

Проверка жестов физического трекпада и смены DPI между мониторами требует соответствующего оборудования; автоматический запуск на macOS-runner не заменяет эти проверки. Developer ID и notarization требуют учётных данных Apple.

Для Vite исключены `artifacts`, release и кэши, чтобы watcher не пытался открыть заблокированные служебные файлы Electron. Только локальный dev HTML разрешает inline HMR preamble; production CSP остаётся `script-src 'self'`. IPC URL сравнивается в нормализованном виде.
