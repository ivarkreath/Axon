# Axon

Локальный desktop-редактор схем и заметок для Windows и macOS. React + TypeScript + Electron, русский интерфейс, редактируемые `.axon`, изображения внутри проекта и экспорт PNG / SVG / PDF. Новый документ пустой; аккаунт и интернет для работы не нужны.

## Установка на Mac

Готовые сборки: [Axon 0.1.0 для macOS](https://github.com/ivarkreath/Axon/releases/tag/v0.1.0-macos).

- **Apple Silicon (серии M):** `Axon-0.1.0-mac-arm64.dmg`.
- **Intel:** `Axon-0.1.0-mac-x64.dmg`.

Откройте DMG и перетащите Axon в «Программы». Node.js для готового приложения не нужен. В релизе также есть ZIP и контрольные суммы SHA-256. Репозиторий закрытый: для скачивания нужен вход в GitHub с доступом к нему.

Обе архитектуры собраны и запущены на macOS в GitHub Actions. Это предварительный релиз с подписью ad-hoc, без Apple Developer ID и notarization; macOS может запросить разрешение на открытие. Подробности проверок и оставшиеся ограничения — в [протоколе](docs/verification.md).

## Запуск из исходников

```sh
npm ci
npm run setup:electron
npm run dev
```

Требуется Node.js 24. `npm run build` и `npm start` используются для разработки и проверок.

Постоянное production-приложение Windows x64: **`D:\Axon\release\win-unpacked\Axon.exe`** (относительно корня `release/win-unpacked/Axon.exe`). Сохраните работу и закройте Axon, затем выполните **`npm run dist:win`**. Команда проверит код, подготовит весь комплект отдельно, безопасно заменит каноническую папку и проверит запуск этого EXE. При следующем обновлении команда и путь те же; ярлык должен указывать на этот EXE. `package:win` — alias того же pipeline. Установщик и соседние test/fixed/new-копии не создаются; служебные staging и DLL не являются альтернативными приложениями. Подробности и откат — в [разработке](docs/development.md), фактический результат — в [протоколе](docs/verification.md). Windows-копия не подписана; собранные файлы не хранятся в Git.

## Возможности

- Фигуры, текст, стикеры, карандаш и PNG/JPEG; редактирование на холсте.
- Прямые/угловые/плавные связи с независимыми визуальными окончаниями и подписями; move/resize, группы, блокировки, копирование, порядок и выравнивание.
- Undo/Redo, привычные клавиши, pan/zoom, направляющие и независимые привязки.
- New/Open/Save/Save As, последние файлы, безопасная запись и отдельная рабочая копия.
- Экспорт всего документа или выделения; переносимая кириллица, прозрачный PNG/SVG, копирование PNG.
- Тёмная, светлая и системная тема отдельно от фона документа.

## Проверки и сборка

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:desktop
npm run test:interactions
npm run test:recovery
npm run test:exports
npm run dist:win
```

`npm run dist:mac` запускается на Mac. Для сборки обеих архитектур и публикации DMG/ZIP есть ручной workflow **macOS release** в GitHub Actions. Windows и macOS проверяются отдельно; результаты — в протоколе проверок. macOS использует локальную подпись ad-hoc; Developer ID и notarization отсутствуют. Windows-сборка не подписана.

## Документация

[PRD](docs/prd.md) · [Архитектура](docs/architecture.md) · [Формат документа](docs/document-format.md) · [Поведение редактора](docs/editor-model.md) · [Дизайн-система](docs/design-system.md) · [Разработка](docs/development.md) · [Проверки и ограничения](docs/verification.md).

Исходный пользовательский PRD сохранён как `Desktop_Whiteboard_PRD_v2.md`. Тестовая сцена создаётся в `artifacts/acceptance.axon` desktop-тестом и не является стартовым содержимым или библиотекой шаблонов. Лицензии зависимостей: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
