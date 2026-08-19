/**
 * Мінімальний jest-трансформер: знімає ESM-синтаксис з файлів `assets/js/**`,
 * щоб тести могли завантажувати САМЕ той код, який виконується в браузері.
 *
 * Навіщо: усі модулі проєкту пишуть себе в `window.*` і додатково реекспортують
 * те саме через `export`. Node/jest не вміє `export` у CJS-пакеті, а вводити
 * babel-preset заради цього — зайва залежність для проєкту без збірки.
 * Тому просто прибираємо рядки `export ...`; побічних ефектів немає, бо
 * реальний контракт між файлами — це `window`, а не експорти.
 *
 * Форми, які зустрічаються в репозиторії (усі з початку рядка):
 *   export { a, b };            → видаляється
 *   export const f = window.f;  → const f = window.f;
 *   export function f() {}      → function f() {}
 *   import { x } from "./y.js"; → видаляється (лише app.js, у тестах не вантажиться)
 */
module.exports = {
  process(src, filename) {
    const code = src
      .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm, "")
      .replace(/^export\s*\{[^}]*\}\s*;?[ \t]*$/gm, "")
      .replace(/^export\s+(const|let|var|function|class|async)\b/gm, "$1");
    return { code };
  },
  // Кеш jest має інвалідуватись, коли міняється сам трансформер.
  getCacheKey(src, filename) {
    return require("crypto")
      .createHash("sha1")
      .update(src)
      .update(filename)
      .update(require("fs").readFileSync(__filename))
      .digest("hex");
  },
};
