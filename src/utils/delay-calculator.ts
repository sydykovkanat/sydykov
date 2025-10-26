/**
 * Калькулятор случайных задержек для имитации занятости
 */

export interface DelayResult {
  delayMs: number;
  delayType: 'normal' | 'medium' | 'long';
  delaySeconds: number;
}

/**
 * Вычисляет случайную задержку перед ответом на сообщение
 * @param normalProbability - вероятность обычной задержки (2 сек)
 * @param mediumProbability - вероятность средней задержки (5-15 мин)
 * @param longProbability - вероятность длинной задержки (30-60 мин)
 * @param isOwner - если true, всегда возвращает минимальную задержку (2 сек)
 * @returns задержка в миллисекундах и тип задержки
 */
export function calculateDelay(
  normalProbability: number = 0.8,
  mediumProbability: number = 0.15,
  longProbability: number = 0.05,
  isOwner: boolean = false,
): DelayResult {
  // Для владельца всегда минимальная задержка
  if (isOwner) {
    return {
      delayMs: 2000,
      delayType: 'normal',
      delaySeconds: 2,
    };
  }

  // Генерируем случайное число от 0 до 1
  const random = Math.random();

  // Определяем тип задержки на основе вероятностей
  let cumulativeProbability = 0;

  // Обычная задержка (2 секунды)
  cumulativeProbability += normalProbability;
  if (random < cumulativeProbability) {
    return {
      delayMs: 2000,
      delayType: 'normal',
      delaySeconds: 2,
    };
  }

  // Средняя задержка (5-15 минут)
  cumulativeProbability += mediumProbability;
  if (random < cumulativeProbability) {
    const delayMinutes = 5 + Math.random() * 10; // 5-15 минут
    const delaySeconds = Math.floor(delayMinutes * 60);
    return {
      delayMs: delaySeconds * 1000,
      delayType: 'medium',
      delaySeconds,
    };
  }

  // Длинная задержка (30-60 минут)
  const delayMinutes = 30 + Math.random() * 30; // 30-60 минут
  const delaySeconds = Math.floor(delayMinutes * 60);
  return {
    delayMs: delaySeconds * 1000,
    delayType: 'long',
    delaySeconds,
  };
}

/**
 * Форматирует задержку в человекочитаемый формат
 */
export function formatDelay(delaySeconds: number): string {
  if (delaySeconds < 60) {
    return `${delaySeconds}s`;
  }

  const minutes = Math.floor(delaySeconds / 60);
  const seconds = delaySeconds % 60;

  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}
