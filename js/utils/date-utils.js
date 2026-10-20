/**
 * Парсит строку даты из формата сервера (DD/MM/YYYY HH:MM) в объект Date.
 * @param {string} str
 * @returns {Date|null}
 */
export function parseServerDate(str) {
    if (!str || str === '—' || typeof str !== 'string') return null;
    // Ищем DD/MM/YYYY HH:MM
    const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!match) return null;

    const [_, day, month, year, hours, minutes] = match;
    return new Date(year, month - 1, day, hours, minutes);
}