// Восстанавливаем сохраненный порядок и ширину из localStorage при старте
const savedOrder = localStorage.getItem('tableColumnOrder');
const savedWidths = JSON.parse(localStorage.getItem('tableColumnWidths') || '{}');

/**
 * ЕДИНАЯ ТОЧКА ПРАВДЫ ДЛЯ СКРЫТИЯ КОЛОНОК ПО РЕЖИМАМ
 * Ключ — режим data-mode журнала таблицы, значение — массив ID скрываемых колонок.
 */
export const HIDDEN_IN_MODE = {
    open: ['solution', 'close_name', 'close_date'],
    close: [] // В режиме закрытых заявок отображаются абсолютно все 12 колонок
};

// Главная конфигурация структуры колонок с поддержкой минимальной ширины (minWidth)
export const tableSettings = {
    "columns": [
        { "id": "id", "name": "№", "sortable": true, "movable": false, "dataType": "number", "hidden": false, "minWidth": 80 },
        { "id": "address", "name": "Адрес", "sortable": true, "movable": false, "dataType": "string", "hidden": false, "minWidth": 260 },
        { "id": "details", "name": "Описание проблемы", "sortable": false, "movable": true, "dataType": "string", "hidden": false, "minWidth": 220 },
        { "id": "staff", "name": "Ответственный", "sortable": true, "movable": true, "dataType": "string", "hidden": false, "minWidth": 160 },

        { "id": "staff_date", "name": "Статус уведомления", "sortable": true, "movable": true, "dataType": "string", "hidden": false, "minWidth": 220 },
        { "id": "department", "name": "Отдел", "sortable": false, "movable": true, "dataType": "string", "hidden": false, "minWidth": 160 },

        { "id": "date", "name": "Дата создания", "sortable": true, "movable": true, "dataType": "date", "hidden": false, "minWidth": 140 },
        { "id": "repair_time", "name": "Дата ремонта", "sortable": true, "movable": true, "dataType": "date", "hidden": false, "minWidth": 150 },

        { "id": "solution", "name": "Решение/Устранение", "sortable": false, "movable": true, "dataType": "string", "hidden": false, "minWidth": 180 },
        { "id": "close_name", "name": "Кто закрыл", "sortable": true, "movable": true, "dataType": "string", "hidden": false, "minWidth": 150 },
        { "id": "close_date", "name": "Дата закрытия", "sortable": true, "movable": true, "dataType": "date", "hidden": false, "minWidth": 140 },
        { "id": "other", "name": "Дополнительно", "sortable": false, "movable": true, "dataType": "string", "hidden": false, "minWidth": 140 }
    ]
};

// Применяем сохраненную ранее ширину колонок из localStorage
tableSettings.columns.forEach(col => {
    if (savedWidths[col.id]) {
        col.width = savedWidths[col.id];
    } else {
        col.width = `${col.minWidth}px`; // Если кэша нет, выставляем базовый minWidth
    }
});

if (savedOrder) {
    const orderIds = savedOrder.split(',');
    // indexOf(-1) → колонки, которых нет в сохранённом порядке,
    // уезжают в конец, а не в начало
    const orderIndex = id => {
        const i = orderIds.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    tableSettings.columns.sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
}

/**
 * Вспомогательная функция для динамического расчета отступа фиксации второй колонки (Адрес)
 */
export function getFreezeLeftOffset() {
    const idColumn = tableSettings.columns.find(c => c.id === 'id');
    return idColumn && idColumn.width ? parseInt(idColumn.width) : 80;
}
