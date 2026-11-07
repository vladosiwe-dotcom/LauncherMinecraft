# Сборка, запуск и настройка

## Требования

- Node.js 20+ и npm (лаунчер и бэкенд).
- JDK 21 (мод и сервер).
- Linux-сервер для продакшена: 4+ ядра, 16 ГБ ОЗУ, SSD. Доменное имя с HTTPS.

## 1. Сервер Minecraft

```bash
cd server
./install.sh /opt/rift/server/runtime 21.1.172   # подставьте актуальную 21.1.x
```

Скрипт проверяет Java 21, скачивает установщик NeoForge, сверяет контрольную сумму и ставит сервер. Затем копирует наши `server.properties` и `user_jvm_args.txt` (существующие файлы не перезаписываются) и спрашивает согласие с EULA.

Размер памяти задаётся в `user_jvm_args.txt`: `-Xms`/`-Xmx`, примерно 70% ОЗУ машины.

## 2. Бэкенд и Rift Control

```bash
npm install && npm run build
cd backend
export RIFT_DATA_DIR=/var/lib/rift
npm run create-owner -- owner          # один раз; пароль выводится в консоль
npm start
```

Переменные окружения:

| Переменная | Значение по умолчанию | Назначение |
|---|---|---|
| `RIFT_PORT`, `RIFT_BIND` | `8080`, `127.0.0.1` | где слушает бэкенд (наружу — только через HTTPS-прокси) |
| `RIFT_PUBLIC_URL` | `http://localhost:8080` | публичный HTTPS-адрес; из него строятся ссылки на файлы в манифесте |
| `RIFT_DATA_DIR` | `./data` | сборки, библиотека файлов, ключ подписи, бэкапы, журнал |
| `RIFT_SERVER_DIR` | — | папка сервера из шага 1; без неё нет управления процессом |
| `RIFT_MC_HOST`, `RIFT_MC_PORT` | `play.example.org`, `25565` | адрес, который получат игроки |
| `RIFT_STATUS_HOST` | `127.0.0.1` | куда бэкенд пингует сервер для статуса |
| `RIFT_TRUST_PROXY` | — | `1`, если бэкенд стоит за Caddy или nginx |
| `RIFT_BACKUP_KEEP` | `14` | сколько обычных бэкапов хранить |

Готовые файлы для продакшена лежат в `server/deploy/`:
- `rift-backend.service` — systemd;
- `Caddyfile` — HTTPS с автоматическим сертификатом;
- `rift-backup.timer` — ежедневный бэкап для сервера без панели.

При первом старте бэкенд создаёт ключ подписи `data/keys/manifest-ed25519.pem` и печатает его id. Публичный ключ из `manifest-ed25519.pub.pem` нужно вставить в конфиг лаунчера.

## 3. Лаунчер

Отредактируйте `launcher/config/app.json`:

```json
{
  "apiBase": "https://rift.example.org",
  "azureClientId": "<ваш Application (client) ID>",
  "trustedManifestKeys": ["-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"],
  "allowInsecureLocalApi": false
}
```

**Azure App ID для входа Microsoft:**
1. Azure Portal → App registrations → New registration. Тип аккаунтов: *Personal Microsoft accounts only*.
2. Authentication → включите *Allow public client flows* (нужно для device code).
3. Подайте заявку Mojang на доступ к Minecraft API для этого App ID (форма Microsoft «Minecraft Java Edition API access»). Пока заявку не одобрят, шаг `login_with_xbox` будет возвращать ошибку.

Сборка установщиков:

```bash
cd launcher
npm run dist     # electron-builder: NSIS для Windows, DMG для macOS, AppImage для Linux
```

Для публичного распространения установщики нужно подписать сертификатом разработчика: Authenticode для Windows, notarization для macOS.

## 4. Клиентский мод

```bash
cd client-mod
gradle build      # или ./gradlew build после `gradle wrapper`
# результат: build/libs/spellironrift-core-<версия>.jar
gradle runClient  # dev-клиент для проверки меню
```

Готовый jar загружается в Rift Control → «Моды и ресурспаки». В сборке у него должна стоять сторона «Клиент».

**Фон меню.** Мод рисует ванильную панораму, а наш ресурспак Rift UI заменяет её текстуры `minecraft:textures/gui/title/background/panorama_0..5.png` скриншотами локации проекта. Ресурспак добавляется в сборку и отмечается как обязательный.

## 5. Первая сборка

1. Rift Control → «Моды и ресурспаки»: загрузите моды (jar NeoForge 1.21.1), ресурспак Rift UI, шейдерпак и конфиги.
2. «Сборки» → «Новая сборка»: добавьте файлы, проверьте стороны (клиент/сервер/оба), режим конфигов и пресеты для шейдеров.
3. Блок «Проверка сборки» должен быть зелёным.
4. «Отправить на тест»: лаунчеры с каналом «Тестовый» получат эту сборку.
5. «Опубликовать»: бэкап мира, обновление серверных модов, подписанный манифест для всех игроков.
