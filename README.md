# Axon

Локальный desktop-редактор схем и заметок для Windows и macOS. React + TypeScript + Electron, русский интерфейс, редактируемые `.axon`, изображения внутри проекта и экспорт PNG / SVG / PDF. Новый документ пустой; аккаунт и интернет для работы не нужны.

## Запуск из исходников

```sh
npm ci
npm run setup:electron
npm run dev
```

Требуется Node.js 24. После `npm run build` готовая локальная сборка запускается через `npm start`. На Windows распакованное приложение — `release/win-unpacked/Axon.exe`; статус фактической сборки см. в [протоколе проверок](docs/verification.md).

Установщик Windows x64 создаётся командой `npm run dist:win` в `release/Axon Setup 0.1.0.exe`. Собранные файлы, кэши и результаты локальных проверок не хранятся в Git. Подпись и проверка установки на чистой системе пока не выполнены.

## Возможности

- Фигуры, текст, стикеры, карандаш и PNG/JPEG; редактирование на холсте.
- Прямые/ортогональные связи с привязками и подписями; move/resize, группы, блокировки, копирование, порядок и выравнивание.
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

`npm run dist:mac` настроен для запуска на Mac. Windows и macOS проверяются отдельно; наличие конфигурации не означает проверку платформы. Приложение не подписано, notarization не выполнена.

## Документация

[PRD](docs/prd.md) · [Архитектура](docs/architecture.md) · [Формат документа](docs/document-format.md) · [Поведение редактора](docs/editor-model.md) · [Дизайн-система](docs/design-system.md) · [Разработка](docs/development.md) · [Проверки и ограничения](docs/verification.md).

Исходный пользовательский PRD сохранён как `Desktop_Whiteboard_PRD_v2.md`. Тестовая сцена создаётся в `artifacts/acceptance.axon` desktop-тестом и не является стартовым содержимым или библиотекой шаблонов. Лицензии зависимостей: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
