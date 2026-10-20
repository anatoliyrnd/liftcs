import { rebuildTableHeaders } from './table/header-render.js';
import { renderTableBody } from './table/body-render.js';
import { sortRows } from './table/sorting.js';
import { buildRowsCache, applyFilter } from './table/filtering.js';
import { renderPeriodSelector } from './table/period-selector.js';
import { API } from './config.js';
import {logHistoryAction} from './history-logger.js';
import { offlineDB } from './offline-db.js';
import { UI } from './config.js';
import { parseServerDate } from './utils/date-utils.js';
import { SyncManager } from './sync-manager.js'; // нам нужен будет доступ к синхронизации
export class TicketsController {
    /**
     * @param {ApiService} apiInstance - Экземпляр сетевого клиента
     * @param {Router} routerInstance - Экземпляр SPA-роутера
     * @param {string} dataType - 'open' | 'close'
     */
    constructor(apiInstance, routerInstance, dataType = 'open') {
        this.api = apiInstance;
        this.router = routerInstance;
        this.dataType = dataType;
        this.selectedDays = localStorage.getItem('tablePeriod_' + this.dataType) || '1';

        this.rowsCache = [];
        this.isAscending = true;
        this.currentSortColumnId = -1;
        this.refreshIntervalId = null;

        // Флаг стейта загрузки: сбрасывается только явным действием пользователя.
        // При ошибке сети НЕ выставляется в true — вкладка не «залипает».
        this.isLoaded = false;
        this._searchDebounceTimer = null;

        // Настройки фильтров
        this._filters = {
            cities: [], // массив ID
            hideLongRepair: false
        };
        this._allCities = []; // Список всех городов для дропдауна
    }

    /**
     * Точка входа для инициализации экрана таблицы.
     * Порядок: мгновенный рендер из памяти → сетевой запрос в фоне.
     */
    async mount(globalTicketsArrayRef) {
        const dataTable = document.getElementById('dataTable');
        if (!dataTable) return;

        dataTable.setAttribute('data-mode', this.dataType);
        if (this.dataType === 'open') {
            await this._initFilters();
            await this._updateSyncButton();
        } else {
            // Для закрытых заявок скрываем фильтры
            const filtersBlock = document.getElementById('openOnlyFilters');
            if (filtersBlock) filtersBlock.style.display = 'none';
        }
        this._initPeriodSelector(globalTicketsArrayRef);

        // 1. МГНОВЕННЫЙ РЕНДЕР из того, что уже лежит в памяти.
        //    При возврате из карточки пользователь сразу видит старые данные —
        //    никакого «пустого экрана на секунду», пока идёт сеть.
        const hadData = globalTicketsArrayRef.length > 0;
        this._renderTableFull(dataTable, globalTicketsArrayRef);
        if (this.currentSortColumnId !== -1) {
            this._reApplyCurrentSort();
        }

        // 2. СЕТЕВОЙ ЗАПРОС.
        const needBlockingLoad = !this.isLoaded || !hadData;

        const loadData = async (isSilent) => {
            const fresh = await this._loadDataFromServer(isSilent);
            if (!fresh) return; // Если сервер упал и сети нет

            let offlineTickets = [];
            if (this.dataType === 'open') {
                const outbox = await offlineDB.getAllFromOutbox();
                // Превращаем офлайн-заявки в формат таблицы
                offlineTickets = outbox.map(o => ({
                    ...o.payload,
                    id: o.uuid, // Используем локальный UUID как ID
                    type: 'open',
                    isOffline: true,
                    date: new Date(o.created_at).toLocaleString('ru')
                }));
            }

            // Офлайн-заявки встают в начало списка
            globalTicketsArrayRef.length = 0;
            globalTicketsArrayRef.push(...offlineTickets, ...fresh);

            this._renderTableFull(dataTable, globalTicketsArrayRef);
            if (this.currentSortColumnId !== -1) {
                this._reApplyCurrentSort();
            }
        };

        if (needBlockingLoad) {
            await loadData(false);
        } else {
            loadData(true); // Фоновое обновление
        }
        // 3. АВТООБНОВЛЕНИЕ раз в 20 сек — только для открытых
        if (this.refreshIntervalId) clearInterval(this.refreshIntervalId);

        if (this.dataType === 'open') {
            this.refreshIntervalId = setInterval(async () => {
                loadData(true)
                if (window.location.hash !== '#/' && window.location.hash !== '') {
                    this.unmount();
                    return;
                }

                const fresh = await this._loadDataFromServer(true);
                if (!fresh) return; // при ошибке — таблица остаётся как была

                globalTicketsArrayRef.length = 0;
                globalTicketsArrayRef.push(...fresh);

                this._renderTableFull(dataTable, globalTicketsArrayRef);
                if (this.currentSortColumnId !== -1) {
                    this._reApplyCurrentSort();
                }
            }, API.TICKETS_REFRESH_MS);
        }

        // 4. Кнопка ручной перезагрузки
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.onclick = (e) => {
                if (e) e.preventDefault();
                this.unmount();
                this.isLoaded = false;
                this.mount(globalTicketsArrayRef);
            };
        }
    }

    /**
     * Деструктор фонового интервала мониторинга.
     */
    unmount() {
        if (this.refreshIntervalId) {
            clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = null;
        }

        // Отменяем все «висящие» сетевые запросы этой вкладки
        this.api.abortTag('tickets_' + this.dataType);

        // Чистим незавершённый дебаунс поиска (п.5)
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }
    }

    /**
     * Сетевой POST к MySQL-шлюзу.
     * НЕ пишет в переданный массив — возвращает свежие данные наверх.
     * Это защищает UI от очистки таблицы при сбое сети: массив обновится
     * только если запрос прошёл успешно.
     * @returns {Array|null} массив заявок при успехе, null при ошибке
     */
    async _loadDataFromServer(isSilent = false) {

        try {
            const postPayload = { data: this.dataType };
            const statusMessage = isSilent ? '' : 'Синхронизация инцидентов...';

            if (this.dataType === 'close') {
                postPayload.period = this.selectedDays;
            }

            const data = await this.api.post(postPayload, statusMessage, 'tickets_' + this.dataType);
            // Игнорируем намеренную отмену запроса
            if (data && data.code === 'aborted') return null;
            if (!data || data.status === 'error') {
                throw new Error((data && data.message) || 'Сбой структуры БД');
            }
            if (!Array.isArray(data)) {
                throw new Error('Ожидался массив заявок, получено: ' + typeof data);
            }

            data.forEach(item => {
                if (!item.type) item.type = this.dataType;
            });

            this.isLoaded = true;

            if (!isSilent) logHistoryAction('Журнал успешно импортирован.');
            return data;

        } catch (error) {
            console.error('[TicketsController] Load error:', error);

            logHistoryAction('Сбой сети: ' + (error.message || 'нет соединения'));
            return null;
        }
    }
    /**
     * Полный перерендер таблицы + навешивание кликов на строки.
     */
    _renderTableFull(dataTable, globalTicketsArrayRef) {

        this._currentTicketsRef = globalTicketsArrayRef; // Сохраняем ссылку для фильтров

        // ПРИМЕНЯЕМ ФИЛЬТРЫ (только для открытых)
        let filteredData = [...globalTicketsArrayRef];
        if (this.dataType === 'open') {
            const maxDate = new Date();
            maxDate.setDate(maxDate.getDate() + UI.FILTER_REPAIR_DAYS);

            filteredData = filteredData.filter(t => {
                // 1. Фильтр по городам
                if (t.city_id && !this._filters.cities.includes(Number(t.city_id))) {
                    return false;
                }

                // 2. Фильтр по дате ремонта
                if (this._filters.hideLongRepair) {
                    const rDate = parseServerDate(t.repair_time);
                    if (rDate && rDate > maxDate) {
                        return false; // Скрываем, если дата больше, чем сегодня + 14 дней
                    }
                }
                return true; // Если repair_time пустой — оставляем
            });
        }

        rebuildTableHeaders(
            dataTable,
            (th, colId, type) => this._handleSort(th, colId, type),
            () => this._refreshRowsCache()
        );

        // Передаем отфильтрованный массив
        renderTableBody(dataTable, filteredData);

        this._refreshRowsCache();
        this._initSearch();

        // Клики по строкам → карточка инцидента
        dataTable.querySelectorAll('tbody tr').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', (e) => {
                if (e.target.classList.contains('resizer')) return;
                this.unmount();

                const idCell = row.querySelector('td[data-col-id="id"]');
                if (!idCell) return;
                this.router.navigate('#/ticket/' + idCell.textContent);
            });
        });

        // Переприменяем активный фильтр после тихого обновления
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value.trim() !== '') {
            applyFilter(this.rowsCache, searchInput.value.trim().toLowerCase());
        }
    }

    /**
     * Рендер селектора периода для закрытых заявок.
     */
    _initPeriodSelector(globalTicketsArrayRef) {
        if (this.dataType !== 'close') return;

        const container = document.getElementById('periodSelectorContainer');
        renderPeriodSelector(container, this.selectedDays, (value) => {
            this.unmount();
            this.selectedDays = value;
            localStorage.setItem('tablePeriod_' + this.dataType, value);
            this.isLoaded = false;
            this.mount(globalTicketsArrayRef);
            // массив не трогаем — mount сам заменит его при успехе.
            // Если новый период не загрузится — пользователь увидит старые данные
            // и запись об ошибке в «Истории».
        });
    }

    /**
     * Навешивание обработчика поиска (oninput — защита от утечек).
     */
    _initSearch() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput) return;

        // Сброс предыдущего таймера при повторной инициализации (возврат из карточки и т.п.)
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }

        searchInput.oninput = (e) => {
            const value = e.target.value;
            if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = setTimeout(() => {
                applyFilter(this.rowsCache, value.trim().toLowerCase());
                this._searchDebounceTimer = null;
            }, 200);
        };
    }
    /**
     * Пересборка кэша строк для поиска.
     */
    _refreshRowsCache() {
        const dataTable = document.getElementById('dataTable');
        this.rowsCache = buildRowsCache(dataTable);
    }

    /**
     * Клик по заголовку колонки: переключение направления + пересортировка.
     */
    _handleSort(headerElement, columnId, dataType) {
        if (this.currentSortColumnId === columnId) {
            this.isAscending = !this.isAscending;
        } else {
            this.isAscending = true;
            this.currentSortColumnId = columnId;
        }

        const dataTable = document.getElementById('dataTable');
        dataTable.querySelectorAll('th.sortable').forEach(h =>
            h.classList.remove('sort-asc', 'sort-desc')
        );
        headerElement.classList.add(this.isAscending ? 'sort-asc' : 'sort-desc');

        this._applySort(columnId, this.isAscending);
    }

    /**
     * Переприменение сортировки после тихого фонового обновления.
     */
    _reApplyCurrentSort() {
        if (this.currentSortColumnId === -1) return;
        this._applySort(this.currentSortColumnId, this.isAscending);
    }

    /**
     * Внутренний метод: сортировка DOM-строк + пересборка кэша.
     */
    _applySort(columnId, isAscending) {
        const dataTable = document.getElementById('dataTable');
        if (!dataTable) return;

        const tbody = dataTable.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        sortRows(rows, columnId, isAscending);
        rows.forEach(row => tbody.appendChild(row));
        this._refreshRowsCache();
    }
    async _initFilters() {
        const filtersBlock = document.getElementById('openOnlyFilters');
        if (filtersBlock) filtersBlock.style.display = 'flex';

        // Установка лейбла для чекбокса срока
        const label = document.getElementById('hideLongRepairLabel');
        if (label) label.textContent = UI.FILTER_REPAIR_LABEL;

        // Восстановление из localStorage
        const savedCities = localStorage.getItem('filter_cities');
        const savedHideLong = localStorage.getItem('filter_hide_long');

        this._filters.hideLongRepair = savedHideLong === 'true';
        const hideCheck = document.getElementById('hideLongRepair');
        if (hideCheck) hideCheck.checked = this._filters.hideLongRepair;

        // Получаем все города из IndexedDB
        this._allCities = await offlineDB.getCities();

        if (savedCities) {
            this._filters.cities = JSON.parse(savedCities);
        } else {
            this._filters.cities = this._allCities.map(c => c.id); // По умолчанию все
        }

        this._renderCityDropdown();

        // Обработчики
        const cityBtn = document.getElementById('cityFilterBtn');
        const cityDropdown = document.getElementById('cityFilterDropdown');

        // Создаем подложку для затемнения (один раз)
        let backdrop = document.getElementById('cityFilterBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'cityFilterBackdrop';
            backdrop.className = 'filter-backdrop';
            document.body.appendChild(backdrop);

            // Клик по затемнению закрывает дропдаун
            backdrop.onclick = () => {
                cityDropdown.style.display = 'none';
                backdrop.style.display = 'none';
            };
        }

        if (cityBtn && cityDropdown) {
            cityBtn.onclick = (e) => {
                e.stopPropagation();
                const isHidden = cityDropdown.style.display === 'none' || !cityDropdown.style.display;
                if (isHidden) {
                    cityDropdown.style.display = 'block';
                    backdrop.style.display = 'block'; // Включаем затемнение
                } else {
                    cityDropdown.style.display = 'none';
                    backdrop.style.display = 'none';  // Выключаем
                }
            };

            // Глобальный клик для закрытия
            document.addEventListener('click', (e) => {
                if (!cityBtn.contains(e.target) && !cityDropdown.contains(e.target)) {
                    cityDropdown.style.display = 'none';
                    backdrop.style.display = 'none';
                }
            });
        }
        const selectAllCb = document.getElementById('citySelectAll');
        if (selectAllCb) {
            selectAllCb.onchange = (e) => {
                if (e.target.checked) {
                    this._filters.cities = this._allCities.map(c => c.id);
                } else {
                    // Оставляем только первый город, чтобы не было пусто
                    this._filters.cities = [this._allCities[0].id];
                }
                this._saveFilters();
                this._renderCityDropdown();
                this._applyLocalFilters();
            };
        }

        const hideCb = document.getElementById('hideLongRepair');
        if (hideCb) {
            hideCb.onchange = (e) => {
                this._filters.hideLongRepair = e.target.checked;
                this._saveFilters();
                this._applyLocalFilters();
            };
        }
    }

    _renderCityDropdown() {
        const list = document.getElementById('cityCheckboxList');
        const btn = document.getElementById('cityFilterBtn');
        const btnText = document.getElementById('cityFilterText');
        const selectAllCb = document.getElementById('citySelectAll');
        if (!list || !btn) return;

        list.innerHTML = '';
        this._allCities.forEach(city => {
            const isChecked = this._filters.cities.includes(city.id);
            const item = document.createElement('label');
            item.className = 'city-checkbox-item';
            item.innerHTML = `
                <input type="checkbox" value="${city.id}" ${isChecked ? 'checked' : ''}>
                <span>${city.name}</span>
            `;
            const cb = item.querySelector('input');
            cb.onchange = (e) => {
                if (e.target.checked) {
                    if (!this._filters.cities.includes(city.id)) this._filters.cities.push(city.id);
                } else {
                    if (this._filters.cities.length === 1) {
                        e.preventDefault();
                        e.target.checked = true; // Возвращаем галочку
                        // notify.warning('Хотя бы один город должен быть выбран'); // Если импортирован notify
                        return;
                    }
                    this._filters.cities = this._filters.cities.filter(id => id !== city.id);
                }
                this._saveFilters();
                this._renderCityDropdown();
                this._applyLocalFilters();
            };
            list.appendChild(item);
        });

        // Обновление кнопки и чекбокса "Выбрать все"
        const allSelected = this._filters.cities.length === this._allCities.length;
        const noneSelected = this._filters.cities.length === 0;

        if (allSelected) {
            btnText.textContent = 'Города: Все';
            btn.classList.remove('filter-active');
            if (selectAllCb) { selectAllCb.checked = true; selectAllCb.indeterminate = false; }
        } else {
            btnText.textContent = `Города: ${this._filters.cities.length} из ${this._allCities.length}`;
            btn.classList.add('filter-active'); // Оранжевый акцент
            if (selectAllCb) { selectAllCb.checked = false; selectAllCb.indeterminate = !noneSelected; }
        }
    }

    _saveFilters() {
        localStorage.setItem('filter_cities', JSON.stringify(this._filters.cities));
        localStorage.setItem('filter_hide_long', this._filters.hideLongRepair.toString());
    }

    _applyLocalFilters() {
        // Перефильтровываем текущие строки
        const dataTable = document.getElementById('dataTable');
        if (!dataTable) return;
        const rows = dataTable.querySelectorAll('tbody tr');
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + UI.FILTER_REPAIR_DAYS);

        rows.forEach(tr => {
            const ticketId = tr.querySelector('td[data-col-id="id"]')?.textContent.trim();
            // Нам нужно взять данные заявки из памяти по ID.
            // Так как DOM не хранит все данные (city_id, repair_time),
            // лучше сделать фильтрацию ДО рендера таблицы.
        });

        // Самый надежный способ - перерендерить таблицу с новыми фильтрами
        this._renderTableFull(document.getElementById('dataTable'), this._currentTicketsRef);
    }

    async _updateSyncButton() {
        const count = await offlineDB.getOutboxCount();
        const btn = document.getElementById('refreshBtn');
        const badge = document.getElementById('syncBadge');
        if (!btn || !badge) return;

        // Если синхронизация идет прямо сейчас — кнопка заблокирована
        if (window.syncManagerInstance && window.syncManagerInstance.isSyncing) {
            btn.disabled = true;
            btn.title = 'Идет синхронизация...';
            return;
        }

        // Проверка кулдауна
        if (window.syncManagerInstance && Date.now() < window.syncManagerInstance._cooldownUntil) {
            const waitMins = Math.ceil((window.syncManagerInstance._cooldownUntil - Date.now()) / 60000);
            btn.disabled = true;
            btn.title = `Синхронизация заблокирована на ${waitMins} мин. из-за ошибки.`;
            btn.style.color = 'var(--text-secondary)';
            return;
        }

        btn.disabled = false; // Разблокируем, если всё ок

        if (count > 0) {
            btn.style.color = '#f59e0b';
            btn.title = `Нажмите, чтобы синхронизировать ${count} офлайн-заявок`;
            badge.textContent = count;
            badge.style.display = 'block';

            btn.onclick = (e) => {
                e.preventDefault();
                window.dispatchEvent(new Event('triggerSync'));
            };
        } else {
            btn.style.color = 'var(--text-primary)';
            btn.title = 'Перезагрузить данные';
            badge.style.display = 'none';

            btn.onclick = (e) => {
                if (e) e.preventDefault();
                this.unmount();
                this.isLoaded = false;
                this.mount(this._currentTicketsRef);
            };
        }
    }


}