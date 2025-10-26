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
pm2 start dist/main.js --name sydykov
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
   - **ВАЖНО**: Ключ берется с **локальной машины**, НЕ с VPS!
   - Как получить:

     ```bash
     # На локальной машине (твой Mac/PC)
     cat ~/.ssh/id_rsa

     # Если ключа нет, создай:
     ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
     # Нажимай Enter на все вопросы
     ```

   - Скопируй весь ключ включая `-----BEGIN OPENSSH PRIVATE KEY-----` и `-----END OPENSSH PRIVATE KEY-----`
   - Это приватный ключ - держи его в секрете!

4. **ENV_FILE**
   - Значение: полное содержимое твоего `.env` файла
   - **ВАЖНО**: Этот файл будет автоматически создаваться на VPS при каждом деплое
   - Как получить:

     ```bash
     # Вариант 1: Скопируй с VPS (если уже есть)
     ssh username@vps-host "cat ~/sydykov/.env"

     # Вариант 2: Используй локальный .env (если настроен)
     cat .env

     # Вариант 3: Используй helper скрипт
     ./scripts/env-backup.sh
     ```

   - Скопируй весь файл целиком и вставь в GitHub Secret
   - После настройки `.env` будет автоматически обновляться при деплое

#### Опциональные:

5. **VPS_PORT** (если используешь нестандартный SSH порт)
   - Значение: порт SSH
   - По умолчанию: `22`

### 3. Настройка SSH ключей (если еще не настроено)

**На локальной машине (твой Mac/PC):**

```bash
# 1. Проверь есть ли SSH ключ
ls ~/.ssh/id_rsa

# 2. Если нет - создай новый ключ
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
# Просто нажимай Enter на все вопросы (или задай passphrase для безопасности)

# 3. Скопируй публичный ключ на VPS
ssh-copy-id root@your-vps-ip
# Введи пароль от VPS (последний раз!)

# 4. Проверь подключение без пароля
ssh root@your-vps-ip
# Должно подключиться автоматически!
```

**Альтернативный способ (если ssh-copy-id не работает):**

```bash
# На локальной машине - выведи публичный ключ
cat ~/.ssh/id_rsa.pub

# Подключись к VPS по паролю
ssh root@your-vps-ip

# На VPS - добавь публичный ключ
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
# Вставь публичный ключ (из id_rsa.pub) на новую строку
# Сохрани: Ctrl+O, Enter, Ctrl+X

chmod 600 ~/.ssh/authorized_keys
exit

# Проверь подключение без пароля
ssh root@your-vps-ip
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

### Рекомендуемый способ: Через GitHub Secrets (автоматизация)

**Как это работает:**

При каждом деплое `.env` файл автоматически создается на VPS из GitHub Secret `ENV_FILE`. Это значит:

- ✅ Не нужно вручную редактировать `.env` на сервере
- ✅ Все изменения в одном месте (GitHub Secrets)
- ✅ Автоматическое обновление при деплое
- ✅ Версионирование через Git (без хранения секретов в коде)

**Как обновить переменные:**

1. Перейди в **Settings → Secrets and variables → Actions → ENV_FILE**
2. Нажми **Update** (карандаш справа)
3. Обнови содержимое `.env` файла
4. Сохрани изменения
5. Сделай любой push в `main` или запусти workflow вручную
6. `.env` на сервере обновится автоматически!

**Первая настройка:**

```bash
# Вариант 1: Получи текущий .env с VPS
ssh username@vps-host "cat ~/sydykov/.env"

# Вариант 2: Используй helper скрипт (рекомендуется)
./scripts/env-backup.sh

# Скопируй весь вывод и добавь в GitHub Secret ENV_FILE
```

### Альтернатива: Напрямую на VPS (не рекомендуется)

⚠️ **Внимание**: Этот способ НЕ рекомендуется, так как изменения будут перезаписаны при следующем деплое!

```bash
ssh username@vps-host
cd ~/sydykov
nano .env
# Внеси изменения
pm2 restart sydykov
```

Если изменил `.env` на VPS, **обязательно** обнови GitHub Secret `ENV_FILE`, иначе изменения потеряются при следующем деплое.

### Бэкап текущего .env с VPS

```bash
# Используй helper скрипт
./scripts/env-backup.sh

# Или вручную
ssh username@vps-host "cat ~/sydykov/.env" > .env.backup
```

---

## 🛠️ Полезные команды

### На VPS

```bash
# Проверить статус
pm2 status sydykov

# Посмотреть логи
pm2 logs sydykov

# Перезапустить
pm2 restart sydykov

# Остановить
pm2 stop sydykov

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
pm2 delete sydykov
pm2 start dist/main.js --name sydykov
pm2 save
```

### База данных не обновилась

```bash
# На VPS
cd ~/sydykov
npx prisma migrate deploy
npx prisma generate
pm2 restart sydykov
```

### Ошибка "command not found" (yarn, node, pm2)

```
bash: line 7: yarn: command not found
bash: line 17: pm2: command not found
```

**Причина:** SSH сессия не загружает PATH для Node.js/npm/yarn.

**Решение 1** (уже в скриптах):
Скрипты уже обновлены и загружают окружение. Просто запуш изменения:

```bash
git add .
git commit -m "fix: update deployment scripts"
git push origin main
```

**Решение 2** (если проблема остается):
На VPS проверь где установлен Node.js:

```bash
# Подключись к VPS
ssh root@your-vps-ip

# Проверь Node.js
which node
which npm
which yarn
which pm2

# Если используешь nvm
source ~/.nvm/nvm.sh
nvm use node

# Если установлено глобально
echo $PATH
```

**Решение 3** (установить заново):

```bash
# На VPS - установка через nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install --lts
npm install -g yarn pm2
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
