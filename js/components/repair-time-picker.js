/**
 * Компонент выбора даты предполагаемого окончания ремонта.
 *
 * Пресеты: +30 мин, +1 час, до конца дня, произвольная дата.
 * Произвольная дата: с сегодняшнего дня (не только с завтра).
 *
 * Валидация: итоговое значение должно быть не менее чем текущее время + 30 минут.
 * Если введённое значение меньше — показывается предупреждение, значение не принимается.
 * Формат значения на выходе: "DD/MM/YYYY HH:MM" (как в API_PROTOCOL.md).
 */

const MIN_AHEAD_MS = 30 * 60 * 1000; // 30 минут

function pad(n) { return String(n).padStart(2, '0'); }

function formatDateTime(d) {
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function formatDateInput(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function formatTimeInput(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function createRepairTimePicker(opts = {}) {
    const {
        initialValue = null,
        onChange = () => {},
        // Смещение серверного времени относительно локального, в миллисекундах.
        // 0 — считаем по локальным часам (текущее поведение).
        // Если сервер пришлёт точное время старта — можно передать разницу.
        serverOffsetMs = 0
    } = opts;
    let currentValue = initialValue;
    let _hasError = false;

    // Единая точка отсчёта «текущего момента» для всех min-проверок.
    // Учитывает возможное смещение серверного времени.
    function now() {
        return new Date(Date.now() + serverOffsetMs);
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    // Текущее значение
    const display = document.createElement('div');
    display.className = 'editable-field';
    display.style.cssText = 'font-size: 13px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); min-height: 32px; display: flex; align-items: center;';
    display.textContent = currentValue || '— не указано —';

    // Селект пресетов
    const select = document.createElement('select');
    select.className = 'search-input editable-field';
    select.style.cssText = 'font-size: 13px; padding: 6px 8px; cursor: pointer;';

    [
        { value: '',         text: '— выбрать срок —' },
        { value: '30min',    text: '30 минут' },
        { value: '1hour',    text: '1 час' },
        { value: 'endday',   text: 'До конца дня' },
        { value: 'custom',   text: 'Другая дата...' }
    ].forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.text;
        select.appendChild(opt);
    });

    // Блок произвольной даты
    const customWrap = document.createElement('div');
    customWrap.style.cssText = 'display: none; gap: 6px; align-items: center;';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'search-input editable-field';
    dateInput.style.cssText = 'font-size: 13px; padding: 6px 8px; flex: 1;';
    // Минимум — дата, в которую попадает getMinAllowed() (сейчас + 30 мин).
    // Это устраняет расхождение: если сейчас 23:50, min = завтра, а не «сегодня по часам устройства».
    dateInput.min = formatDateInput(getMinAllowed());

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'search-input editable-field';
    timeInput.style.cssText = 'font-size: 13px; padding: 6px 8px; width: 120px;';
    timeInput.step = 1800; // шаг 30 минут

    // Значение по умолчанию: now + 30 минут округлённое вверх до шага 30 минут
    const initialMin = getMinAllowed();
    dateInput.value = formatDateInput(initialMin);
    timeInput.value = formatTimeInput(ceilToHalfHour(initialMin));

    customWrap.appendChild(dateInput);
    customWrap.appendChild(timeInput);

    // Предупреждение под полями
    const warn = document.createElement('div');
    warn.style.cssText = 'display: none; color: #ef4444; font-size: 12px; margin-top: 2px;';

    // ====================================================================
    // Валидация
    // ====================================================================

    function getMinAllowed() {
        return new Date(now().getTime() + MIN_AHEAD_MS);
    }

    /** Округляет время вверх до ближайших 30 минут */
    function ceilToHalfHour(d) {
        const copy = new Date(d);
        const minutes = copy.getMinutes();
        if (minutes === 0 || minutes === 30) {
            copy.setSeconds(0, 0);
            return copy;
        }
        if (minutes < 30) {
            copy.setMinutes(30, 0, 0);
        } else {
            copy.setHours(copy.getHours() + 1, 0, 0, 0);
        }
        return copy;
    }

    /** Возвращает Date из значений dateInput + timeInput, либо null */
    function readCustomDate() {
        const d = dateInput.value;
        const t = timeInput.value;
        if (!d || !t) return null;
        const [y, m, day] = d.split('-').map(Number);
        const [hh, mm] = t.split(':').map(Number);
        return new Date(y, m - 1, day, hh, mm, 0, 0);
    }

    /** Проверка: значение не меньше now + 30 мин */
    function isDateValid(target) {
        if (!(target instanceof Date) || isNaN(target.getTime())) return false;
        return target.getTime() >= getMinAllowed().getTime();
    }

    /** Показать/скрыть предупреждение, обновить _hasError */
    function showError(message) {
        _hasError = true;
        warn.textContent = '⚠️ ' + message;
        warn.style.display = 'block';
    }

    function clearError() {
        _hasError = false;
        warn.style.display = 'none';
    }

    /**
     * Обновляет min для timeInput в зависимости от выбранной даты.
     * Если сегодня — min = now + 30 мин; если будущее — 00:00.
     * Если текущее timeInput меньше нового min, время сдвигается к min.
     */
    function syncTimeMin() {
        const minDateStr = formatDateInput(getMinAllowed());
        const selected = dateInput.value;

        if (selected === minDateStr) {
            // Совпали с минимальной датой — режем время до now + 30
            const minTime = formatTimeInput(ceilToHalfHour(getMinAllowed()));
            timeInput.min = minTime;
            if (timeInput.value && timeInput.value < minTime) {
                timeInput.value = minTime;
            }
        } else {
            timeInput.min = '00:00';
        }
    }

    // ====================================================================
    // Применение значений
    // ====================================================================

    function applyPreset(preset) {
        if (!preset) return;
        const nowDate = now();
        let target = null;

        if (preset === '30min') {
            target = new Date(nowDate.getTime() + MIN_AHEAD_MS);
        } else if (preset === '1hour') {
            target = new Date(nowDate.getTime() + 60 * 60 * 1000);
        } else if (preset === 'endday') {
            target = new Date(nowDate);
            target.setHours(23, 59, 0, 0);
        }
        if (target) {
            if (!isDateValid(target)) {
                showError('Выбранное время меньше допустимого (не менее 30 минут от текущего момента).');
                currentValue = null;
                display.textContent = '— не указано —';
                onChange(null);
                return;
            }
            clearError();
            currentValue = formatDateTime(target);
            display.textContent = currentValue;
            onChange(currentValue);
        }
    }

    function applyCustom() {
        syncTimeMin();
        const target = readCustomDate();
        if (!target) return;

        if (!isDateValid(target)) {
            showError('Дата и время должны быть не менее чем через 30 минут от текущего момента.');
            currentValue = null;
            display.textContent = '— не указано —';
            onChange(null);
            return;
        }

        clearError();
        currentValue = formatDateTime(target);
        display.textContent = currentValue;
        onChange(currentValue);
    }

    select.onchange = () => {
        if (select.value === 'custom') {
            customWrap.style.display = 'flex';
            syncTimeMin();
            applyCustom();
        } else {
            customWrap.style.display = 'none';
            clearError();
            applyPreset(select.value);
        }
    };

    dateInput.onchange = () => {
        syncTimeMin();
        applyCustom();
    };
    timeInput.onchange = applyCustom;

    wrap.appendChild(display);
    wrap.appendChild(select);
    wrap.appendChild(customWrap);
    wrap.appendChild(warn);

    // ====================================================================
    // API компонента
    // ====================================================================

    return {
        element: wrap,
        getValue: () => currentValue,

        setValue: (v) => {
            currentValue = v || null;
            display.textContent = currentValue || '— не указано —';
        },

        /**
         * Валиден ли текущий ввод.
         * Возвращает true, если поле пустое (не тронуто пользователем)
         * либо если установленное значение прошло проверку.
         * Возвращает false, если пользователь ввёл невалидное значение.
         */
        isValid: () => !_hasError,

        reset: () => {
            currentValue = initialValue;
            display.textContent = currentValue || '— не указано —';
            select.value = '';
            customWrap.style.display = 'none';
            clearError();

            // Возвращаем дефолты в поля custom
            const freshMin = getMinAllowed();
            dateInput.value = formatDateInput(freshMin);
            timeInput.value = formatTimeInput(ceilToHalfHour(freshMin));
        },

        destroy: () => {
            select.onchange = null;
            dateInput.onchange = null;
            timeInput.onchange = null;
        }
    };
}