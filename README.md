# Spell and Iron Rift

Собственная игровая платформа для Minecraft Java Edition **1.21.1 на NeoForge**. В проекте четыре части:

| Папка | Что это | Технологии |
|---|---|---|
| `launcher/` | Лаунчер для игроков: вход через Microsoft, установка Java, Minecraft и NeoForge, обновление сборки по подписанному манифесту, графические пресеты, ru/uk/en | Electron + TypeScript |
| `backend/` | Сервер обновлений и админ-панель **Rift Control**: моды, ресурспаки, сборки (черновик → тест → публикация → откат), консоль, игроки, бэкапы, новости, MOTD, сотрудники и роли | Node.js + Express + TypeScript |
| `client-mod/` | Клиентский мод NeoForge: своё главное меню с 3D-персонажем игрока, вход сразу на официальный сервер, без одиночной игры и списка серверов | Java 21, NeoForge 21.1.x |
| `server/` | Комплект сервера: установка NeoForge 1.21.1, JVM-флаги, `server.properties`, systemd, бэкапы, HTTPS (Caddy) | bash, systemd |
| `shared/` | Общий код лаунчера и бэкенда: формат манифеста, проверки, подпись Ed25519, пресеты графики | TypeScript |

Документация:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — как устроена система, манифест, обновления, безопасность.
- [docs/SETUP.md](docs/SETUP.md) — сборка, запуск и настройка всех частей.
- [docs/ROADMAP.md](docs/ROADMAP.md) — что готово, что проверено и что осталось.

## Быстрый старт для разработчика

```bash
npm install            # ставит зависимости всех пакетов (Node 20+)
npm test               # сборка + тесты shared, launcher, backend
```

Админ-панель локально:

```bash
cd backend
npm run build
RIFT_DATA_DIR=./data npm run create-owner -- owner   # выводит одноразовый пароль
RIFT_DATA_DIR=./data npm start                       # http://127.0.0.1:8080/admin
```

Лаунчер (нужен Electron с бинарником под вашу ОС):

```bash
cd launcher
npm start
```

Если открыть `launcher/renderer/index.html` или `backend/public/admin/index.html` прямо в браузере, интерфейс запустится в **демо-режиме** с примерными данными. Это видно по полосатой плашке сверху.
