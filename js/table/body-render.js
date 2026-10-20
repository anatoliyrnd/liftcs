import { tableSettings, getFreezeLeftOffset } from './settings.js';

/**
 * Заполняет тело таблицы (TBODY) данными из MySQL и фиксирует № и Адрес.
 *
 * Цветовая индикация: сервер отдаёт alert_level (1 | 2 | 3).
 * Фронт вешает класс row-level-N на <tr>, конкретный цвет приходит из
 * CSS-переменных активной темы (см. style.css). Sticky-ячейки «№» и «Адрес»
 * наследуют фон строки через переменную --row-bg — никаких inline !important.
 */
export function renderTableBody(tableElement, serverData) {
    const tbody = tableElement.querySelector('tbody') || tableElement.appendChild(document.createElement('tbody'));
    tbody.innerHTML = '';

    const freezeLeftOffset = getFreezeLeftOffset(); // Рассчитываем сдвиг left

    serverData.forEach(rowData => {
        const tr = document.createElement('tr');

        // Уровень визуальной тревоги от сервера.
        // 1 — обычный (дефолт), 2 — внимание, 3 — критично.
        // Любое невалидное значение трактуем как 1.
        const rawLevel = Number(rowData.alert_level);
        const alertLevel = (rawLevel >= 1 && rawLevel <= 3) ? rawLevel : 1;

        if (alertLevel > 1) {
            tr.classList.add('row-level-' + alertLevel);
        }

        tableSettings.columns.forEach(col => {
            const td = document.createElement('td');
            td.setAttribute('data-col-id', col.id);

            // Применяем ширину из конфигурации
            const finalWidth = col.width || `${col.minWidth}px`;
            td.style.width = finalWidth;
            td.style.minWidth = `${col.minWidth}px`;
            td.style.maxWidth = finalWidth;

            // Горизонтальная фиксация для Адреса в строках данных
            if (col.id === 'address') {
                td.style.left = `${freezeLeftOffset}px`;
                td.classList.add('sticky-freeze-border');
            }

            // Получаем значение ячейки из пришедшего JSON-пакета
            let cellValue = rowData[col.id] !== undefined ? rowData[col.id] : '';

            // Защита от пустых дат и дефолтных штампов Unix 1970 года
            if (col.dataType === 'date' && (cellValue === '' || String(cellValue).includes('1970'))) {
                cellValue = '—';
            }

            // Прочерк для пустых полей solution/close_name/other
            if (['solution', 'close_name', 'other'].includes(col.id) && String(cellValue).trim() === '') {
                cellValue = '—';
            }

            td.textContent = cellValue;

            // Навешиваем всплывающую подсказку (title) для длинных текстов
            if (['solution', 'details', 'address', 'close_name'].includes(col.id) && cellValue !== '—') {
                td.setAttribute('title', cellValue);
            }

            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}