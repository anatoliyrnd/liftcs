import { tableSettings } from './settings.js';

/**
 * Логика изменения ширины колонок мышью с учётом minWidth.
 * Корректно завершает ресайз, если mouseup произошёл за пределами окна
 * (через window.blur) или если пользователь ушёл на другую вкладку.
 */
export function setupResizableColumn(th, resizer) {
    let startX, startWidth;
    const colId = th.getAttribute('data-id');

    const colConfig = tableSettings.columns.find(c => c.id === colId);
    const minAllowedWidth = colConfig ? colConfig.minWidth : 90;

    function onMouseMove(e) {
        const width = startWidth + (e.clientX - startX);

        if (width >= minAllowedWidth) {
            const widthPx = `${width}px`;

            th.style.width = widthPx;
            th.style.maxWidth = widthPx;

            const table = th.closest('table');
            if (table) {
                table.querySelectorAll(`tbody td[data-col-id="${colId}"]`).forEach(td => {
                    td.style.width = widthPx;
                    td.style.maxWidth = widthPx;
                });

                // Если меняли ширину колонки №, на лету сдвигаем фиксированную колонку Адрес вправо
                if (colId === 'id') {
                    table.querySelectorAll(`th[data-id="address"], td[data-col-id="address"]`).forEach(el => {
                        el.style.left = widthPx;
                    });
                }
            }

            if (colConfig) colConfig.width = widthPx;
        }
    }

    function onMouseUp() {
        // Защита от повторного вызова (mouseup + blur одновременно)
        if (!resizer.classList.contains('resizing')) return;

        const currentWidths = JSON.parse(localStorage.getItem('tableColumnWidths') || '{}');
        if (colConfig && colConfig.width) {
            currentWidths[colId] = colConfig.width;
            localStorage.setItem('tableColumnWidths', JSON.stringify(currentWidths));
        }

        if (colConfig && colConfig.movable) {
            th.setAttribute('draggable', 'true');
        }

        resizer.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // Снимаем страховочные слушатели, чтобы не копились
        window.removeEventListener('blur', onMouseUp);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    function onVisibilityChange() {
        // Если вкладка ушла в фон во время ресайза — принудительно завершаем
        if (document.visibilityState === 'hidden') onMouseUp();
    }

    resizer.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();

        th.setAttribute('draggable', 'false');
        resizer.classList.add('resizing');

        startX = e.clientX;
        startWidth = th.offsetWidth;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        // Страховка: если мышь ушла за пределы окна и пользователь отпустил кнопку там —
        // браузер отдаст событие только после возврата фокуса. Ловим оба сигнала.
        window.addEventListener('blur', onMouseUp);
        document.addEventListener('visibilitychange', onVisibilityChange);
    });
}