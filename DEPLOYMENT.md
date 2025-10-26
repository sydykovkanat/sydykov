# Deployment Guide

Этот проект настроен для автоматического деплоя на VPS через GitHub Actions.

## Архитектура

- **GitHub Actions**: Автоматический деплой при push в `main`
- **VPS**: Redis, PostgreSQL, приложение через PM2
- **SSH Deploy**: Безопасное подключение через SSH ключи
- **Environment**: Переменные окружения через GitHub Secrets

---

## 🚀 Быстрый старт

### 1. Настройка VPS

На твоем VPS должны быть установлены:

```bash
# Node.js 18+
node -v

# Yarn
yarn -v

# PM2
pm2 -v

# Git
git -v

# PostgreSQL (уже есть)
# Redis (уже есть)
```

Клонируй проект на VPS:

```bash
cd ~
git clone <repository-url> sydykov
cd sydykov
yarn install
```

Создай `.env` файл на VPS:

```bash
nano ~/sydykov/.env
```

Вставь свои настройки (см. `.env.example`).

Сделай первый билд и запуск:

```bash
yarn build
npx prisma migrate deploy
npx prisma generate
pm2 start dist/main.js --name sydykov-bot
pm2 save
pm2 startup
```

### 2. Настройка GitHub Secrets

Перейди в настройки репозитория на GitHub: **Settings → Secrets and variables → Actions → New repository secret**

Добавь следующие секреты:

#### Обязательные:

1. **VPS_HOST**
   - Значение: IP адрес или домен твоего VPS
   - Пример: `123.45.67.89` или `vps.example.com`

2. **VPS_USERNAME**
   - Значение: имя пользователя для SSH
   - Пример: `root` или `ubuntu`

3. **VPS_SSH_KEY**
   - Значение: приватный SSH ключ для доступа к VPS
   - Как получить:
     ```bash
     # На локальной машине
     cat ~/.ssh/id_rsa
     ```
   - Скопируй весь ключ включая `-----BEGIN OPENSSH PRIVATE KEY-----` и `-----END OPENSSH PRIVATE KEY-----`

#### Опциональные:

4. **VPS_PORT** (если используешь нестандартный SSH порт)
   - Значение: порт SSH
   - По умолчанию: `22`

### 3. Настройка SSH ключей (если еще не настроено)

На локальной машине:

```bash
# Сгенерируй SSH ключ если его нет
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# Скопируй публичный ключ на VPS
ssh-copy-id username@vps-host

# Проверь подключение
ssh username@vps-host
```

---

## 🔄 Использование

### Автоматический деплой

Просто делай push в `main`:

```bash
git add .
git commit -m "your changes"
git push origin main
```

GitHub Actions автоматически:

1. Подключится к VPS
2. Сделает `git pull`
3. Установит зависимости
4. Запустит миграции
5. Соберет проект
6. Перезапустит PM2

### Ручной деплой

На VPS можешь запустить скрипт деплоя:

```bash
cd ~/sydykov
./scripts/deploy.sh
```

Или запустить GitHub Action вручную:

- Перейди на вкладку **Actions** в GitHub
- Выбери **Deploy to VPS**
- Нажми **Run workflow**

---

## 📝 Управление ENV переменными

### Способ 1: Напрямую на VPS

```bash
ssh username@vps-host
cd ~/sydykov
nano .env
# Внеси изменения
./scripts/deploy.sh  # Перезапустит с новыми настройками
```

### Способ 2: Через GitHub Secrets (для чувствительных данных)

Если хочешь автоматически обновлять `.env` при деплое:

1. Добавь в GitHub Secrets новый секрет **ENV_FILE** со всем содержимым `.env`

2. Обнови [.github/workflows/deploy.yml](.github/workflows/deploy.yml), добавив перед `git pull`:
   ```yaml
   echo "${{ secrets.ENV_FILE }}" > ~/sydykov/.env
   ```

**Внимание**: Этот способ перезапишет весь `.env` файл на VPS.

---

## 🛠️ Полезные команды

### На VPS

```bash
# Проверить статус
pm2 status sydykov-bot

# Посмотреть логи
pm2 logs sydykov-bot

# Перезапустить
pm2 restart sydykov-bot

# Остановить
pm2 stop sydykov-bot

# Мониторинг
pm2 monit
```

### Локально

```bash
# Проверить workflow
cat .github/workflows/deploy.yml

# Подключиться к VPS
ssh username@vps-host
```

---

## 🐛 Troubleshooting

### Деплой не срабатывает

1. Проверь, что workflow включен в настройках репозитория
2. Проверь логи в Actions на GitHub
3. Убедись, что все секреты добавлены

### Ошибка SSH

```
Permission denied (publickey)
```

**Решение:**

- Убедись, что публичный ключ добавлен в `~/.ssh/authorized_keys` на VPS
- Проверь права: `chmod 600 ~/.ssh/authorized_keys`

### PM2 не находит приложение

```bash
# На VPS
cd ~/sydykov
pm2 delete sydykov-bot
pm2 start dist/main.js --name sydykov-bot
pm2 save
```

### База данных не обновилась

```bash
# На VPS
cd ~/sydykov
npx prisma migrate deploy
npx prisma generate
pm2 restart sydykov-bot
```

---

## 📚 Дополнительная информация

### Структура деплоя

```
GitHub Push → GitHub Actions → SSH to VPS → Deploy Script → PM2 Restart
```

### Что происходит при деплое

1. **Git Pull**: Скачиваются последние изменения
2. **Dependencies**: Устанавливаются зависимости (`yarn install`)
3. **Migrations**: Применяются миграции БД (`prisma migrate deploy`)
4. **Build**: Компилируется TypeScript → JavaScript
5. **Restart**: PM2 перезапускает приложение

### Время деплоя

Обычно **2-3 минуты**:

- GitHub Actions: ~30 сек
- SSH + Git Pull: ~10 сек
- Dependencies: ~1 мин (если есть изменения)
- Build: ~30 сек
- Restart: ~5 сек

---

## 🔐 Безопасность

**Важно:**

- ✅ Никогда не коммить `.env` в Git
- ✅ Использовать SSH ключи вместо паролей
- ✅ Хранить секреты в GitHub Secrets
- ✅ Ограничить SSH доступ (например, через fail2ban)
- ✅ Регулярно обновлять зависимости

**Секреты:**

Все чувствительные данные должны быть в GitHub Secrets:

- API ключи (OpenAI, Telegram)
- Строки подключения к БД
- SSH ключи
- Пароли

---

## 🎯 Next Steps

После настройки CI/CD можешь добавить:

1. **Tests в CI**: Запускать тесты перед деплоем
2. **Staging Environment**: Тестовый сервер перед продом
3. **Rollback**: Автоматический откат при ошибках
4. **Monitoring**: Уведомления в Telegram при деплое
5. **Backups**: Автоматические бэкапы БД

Примеры можно добавить в [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
