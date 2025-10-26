/**
 * Генератор случайных опечаток для имитации человеческого набора текста
 */

export interface TypoResult {
  text: string;
  hasTypo: boolean;
  originalText?: string;
}

/**
 * Раскладка клавиатуры для замены соседними буквами
 * Используется русская QWERTY раскладка
 */
const KEYBOARD_LAYOUT: Record<string, string[]> = {
  // Русская раскладка
  а: ['ф', 'ы', 'в', 'с'],
  б: ['н', 'г', 'ю', 'т'],
  в: ['а', 'п', 'м', 'с', 'ы'],
  г: ['п', 'р', 'ш', 'т', 'б'],
  д: ['в', 'а', 'о', 'л', 'ж'],
  е: ['н', 'г', 'п', 'р'],
  ж: ['д', 'л', 'ю', 'э'],
  з: ['я', 'ч', 'щ', 'х'],
  и: ['т', 'ш', 'щ', 'м', 'б'],
  й: ['ц', 'у', 'к', 'е'],
  к: ['у', 'е', 'н', 'г', 'ш'],
  л: ['о', 'д', 'ж', 'э'],
  м: ['и', 'т', 'ь', 'б', 'в'],
  н: ['г', 'к', 'е', 'р'],
  о: ['л', 'д', 'в', 'а', 'р'],
  п: ['е', 'р', 'о', 'т', 'и', 'в'],
  р: ['о', 'л', 'д', 'г', 'н', 'е'],
  с: ['ы', 'в', 'а', 'м'],
  т: ['и', 'п', 'р', 'г', 'б', 'н'],
  у: ['й', 'к', 'ц'],
  ф: ['а', 'я'],
  х: ['з', 'ъ'],
  ц: ['й', 'у', 'ч'],
  ч: ['ц', 'з', 'я', 'с'],
  ш: ['к', 'г', 'щ', 'и'],
  щ: ['з', 'х', 'ъ', 'ш'],
  ъ: ['х', 'ъ', 'э'],
  ы: ['а', 'в', 'с'],
  ь: ['б', 'м', 'т'],
  э: ['ж', 'ъ', 'л'],
  ю: ['б', 'ж'],
  я: ['ф', 'ч', 'з'],
  // Английская раскладка (если иногда пишется на английском)
  q: ['w', 'a'],
  w: ['q', 'e', 's', 'a'],
  e: ['w', 'r', 'd', 's'],
  r: ['e', 't', 'f', 'd'],
  t: ['r', 'y', 'g', 'f'],
  y: ['t', 'u', 'h', 'g'],
  u: ['y', 'i', 'j', 'h'],
  i: ['u', 'o', 'k', 'j'],
  o: ['i', 'p', 'l', 'k'],
  p: ['o', 'l'],
  a: ['q', 'w', 's', 'z'],
  s: ['w', 'e', 'd', 'a', 'z', 'x'],
  d: ['e', 'r', 'f', 's', 'x', 'c'],
  f: ['r', 't', 'g', 'd', 'c', 'v'],
  g: ['t', 'y', 'h', 'f', 'v', 'b'],
  h: ['y', 'u', 'j', 'g', 'b', 'n'],
  j: ['u', 'i', 'k', 'h', 'n', 'm'],
  k: ['i', 'o', 'l', 'j', 'm'],
  l: ['o', 'p', 'k'],
  z: ['a', 's', 'x'],
  x: ['z', 's', 'd', 'c'],
  c: ['x', 'd', 'f', 'v'],
  v: ['c', 'f', 'g', 'b'],
  b: ['v', 'g', 'h', 'n'],
  n: ['b', 'h', 'j', 'm'],
  m: ['n', 'j', 'k'],
};

/**
 * Типы опечаток
 */
enum TypoType {
  SKIP_LETTER = 'skip_letter', // Пропуск буквы
  NEIGHBOR_KEY = 'neighbor_key', // Замена соседней клавишей
  EXTRA_SPACE = 'extra_space', // Лишний пробел
}

/**
 * Пропускает случайную букву в слове
 */
function skipLetter(word: string): string {
  if (word.length <= 3) return word; // Слишком короткое слово

  // Не пропускаем первую и последнюю букву (менее естественно)
  const index = Math.floor(Math.random() * (word.length - 2)) + 1;
  return word.slice(0, index) + word.slice(index + 1);
}

/**
 * Заменяет букву на соседнюю по клавиатуре
 */
function replaceWithNeighbor(word: string): string {
  if (word.length <= 2) return word;

  // Выбираем случайную букву (не первую и не последнюю)
  const index = Math.floor(Math.random() * (word.length - 2)) + 1;
  const letter = word[index].toLowerCase();

  // Проверяем, есть ли соседние клавиши
  const neighbors = KEYBOARD_LAYOUT[letter];
  if (!neighbors || neighbors.length === 0) {
    return word; // Нет соседей - возвращаем как есть
  }

  // Выбираем случайную соседнюю клавишу
  const neighbor = neighbors[Math.floor(Math.random() * neighbors.length)];

  // Сохраняем регистр
  const replacement =
    word[index] === word[index].toUpperCase()
      ? neighbor.toUpperCase()
      : neighbor;

  return word.slice(0, index) + replacement + word.slice(index + 1);
}

/**
 * Добавляет лишний пробел между словами
 */
function addExtraSpace(text: string): string {
  const words = text.split(' ');
  if (words.length <= 1) return text;

  // Выбираем случайное место для лишнего пробела
  const index = Math.floor(Math.random() * (words.length - 1));
  return (
    words.slice(0, index + 1).join(' ') +
    '  ' +
    words.slice(index + 1).join(' ')
  );
}

/**
 * Вносит опечатку в текст с заданной вероятностью
 * @param text - исходный текст
 * @param probability - вероятность опечатки (0-1), по умолчанию 0.15 (15%)
 * @returns объект с текстом (с опечаткой или без) и флагом hasTypo
 */
export function introduceTypo(
  text: string,
  probability: number = 0.15,
): TypoResult {
  // Проверка вероятности
  if (Math.random() > probability) {
    return { text, hasTypo: false };
  }

  // Слишком короткий текст - не трогаем
  if (text.length < 5) {
    return { text, hasTypo: false };
  }

  // Выбираем случайный тип опечатки
  const typoTypes = Object.values(TypoType);
  const typoType = typoTypes[Math.floor(Math.random() * typoTypes.length)];

  let textWithTypo = text;

  try {
    switch (typoType) {
      case TypoType.SKIP_LETTER: {
        // Пропускаем букву в случайном слове
        const words = text.split(' ');
        if (words.length === 0) return { text, hasTypo: false };

        const wordIndex = Math.floor(Math.random() * words.length);
        const word = words[wordIndex];
        const newWord = skipLetter(word);

        if (newWord !== word) {
          words[wordIndex] = newWord;
          textWithTypo = words.join(' ');
        }
        break;
      }

      case TypoType.NEIGHBOR_KEY: {
        // Заменяем букву на соседнюю в случайном слове
        const words = text.split(' ');
        if (words.length === 0) return { text, hasTypo: false };

        const wordIndex = Math.floor(Math.random() * words.length);
        const word = words[wordIndex];
        const newWord = replaceWithNeighbor(word);

        if (newWord !== word) {
          words[wordIndex] = newWord;
          textWithTypo = words.join(' ');
        }
        break;
      }

      case TypoType.EXTRA_SPACE: {
        // Добавляем лишний пробел
        const newText = addExtraSpace(text);
        if (newText !== text) {
          textWithTypo = newText;
        }
        break;
      }
    }
  } catch (error) {
    // Если что-то пошло не так, возвращаем оригинальный текст
    return { text, hasTypo: false };
  }

  // Проверяем, что текст действительно изменился
  if (textWithTypo === text) {
    return { text, hasTypo: false };
  }

  return {
    text: textWithTypo,
    hasTypo: true,
    originalText: text,
  };
}

/**
 * Генерирует случайную задержку для исправления опечатки
 * @param minSeconds - минимальная задержка в секундах (по умолчанию 1)
 * @param maxSeconds - максимальная задержка в секундах (по умолчанию 3)
 * @returns задержка в миллисекундах
 */
export function getTypoFixDelay(
  minSeconds: number = 1,
  maxSeconds: number = 3,
): number {
  const delaySeconds = Math.random() * (maxSeconds - minSeconds) + minSeconds;
  return Math.floor(delaySeconds * 1000);
}
