import { offlineDB } from '../offline-db.js';
import { escapeHtml } from '../utils/escape-html.js';

export function createAddressPicker(opts = {}) {
    const {
        onChange = () => {},
        initialValue = null // { city_id, object_id, display_name }
    } = opts;

    const wrap = document.createElement('div');
    wrap.className = 'address-picker-wrap';
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px; position: relative;';

    // --- 1. Выбор города ---
    const cityWrap = document.createElement('div');
    const cityLabel = document.createElement('label');
    cityLabel.textContent = 'Город';
    cityLabel.style.cssText = 'font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;';

    const citySelect = document.createElement('select');
    citySelect.className = 'search-input';
    citySelect.style.marginTop = '4px';

    cityWrap.appendChild(cityLabel);
    cityWrap.appendChild(citySelect);

    // --- 2. Поиск улицы и дома ---
    const searchWrap = document.createElement('div');
    searchWrap.style.display = 'none'; // Скрыто, пока не выбран город

    const searchLabel = document.createElement('label');
    searchLabel.textContent = 'Поиск адреса (Улица, дом, лифт)';
    searchLabel.style.cssText = 'font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'search-input editable-field';
    searchInput.placeholder = 'Например: Ленина 5';
    searchInput.style.marginTop = '4px';
    searchInput.autocomplete = 'off';

    const dropdown = document.createElement('div');
    dropdown.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 100; max-height: 250px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-top: 4px;';

    searchWrap.appendChild(searchLabel);
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(dropdown);

    wrap.appendChild(cityWrap);
    wrap.appendChild(searchWrap);

    let selectedData = initialValue;
    let currentCities = [];

    // Инициализация городов
    async function loadCities() {
        currentCities = await offlineDB.getCities();
        citySelect.innerHTML = '<option value="">— Выберите город —</option>';
        currentCities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            citySelect.appendChild(opt);
        });

        // Если есть город по умолчанию
        const defaultCity = await offlineDB.getConfig('default_city_id');
        if (defaultCity && currentCities.some(c => c.id === defaultCity)) {
            citySelect.value = defaultCity;
            handleCityChange();
        }
    }

    function handleCityChange() {
        const cityId = citySelect.value;
        if (!cityId) {
            searchWrap.style.display = 'none';
            selectedData = null;
            onChange(null);
            return;
        }
        searchWrap.style.display = 'block';
        searchInput.value = '';
        selectedData = null;
        onChange(null);
        searchInput.focus();
    }

    citySelect.onchange = handleCityChange;

    // --- 3. Логика поиска ---
    let debounceTimer = null;

    async function triggerSearch(val) {
        if (val.length < 2) {
            dropdown.style.display = 'none';
            return;
        }
        const cityId = parseInt(citySelect.value, 10);
        if (!cityId) return;

        // Нормализуем запрос так же, как и search_string в базе
        const q = val.toLowerCase().replace(/[^\wа-яё\s]/gi, ' ').replace(/\s+/g, ' ').trim();

        if (q.length < 2) {
            dropdown.style.display = 'none';
            return;
        }

        const results = await offlineDB.searchAddresses(cityId, q);
        renderDropdown(results);
    }

    searchInput.oninput = () => {
        const val = searchInput.value.trim();
        if (debounceTimer) clearTimeout(debounceTimer);

        // Если пользователь начал менять уже выбранный адрес — сбрасываем валидацию
        if (selectedData && val !== selectedData.address) {
            selectedData = null;
            onChange(null);
        }

        if (val.length < 2) {
            dropdown.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(() => {
            triggerSearch(val);
        }, 250);
    };

    searchInput.onfocus = () => {
        const val = searchInput.value.trim();

        // 1. Если адрес уже выбран, выделяем весь текст.
        // При начале печати он просто заменится новым, а дропдаун не будет мешать.
        if (selectedData && val === selectedData.address) {
            searchInput.select();
            return;
        }

        // 2. Если пользователь ушел, не выбрав адрес (просто набрал текст),
        // при возврате в поле сразу показываем подсказки.
        if (val.length >= 2) {
            triggerSearch(val);
        }
    };
    function renderDropdown(results) {
        dropdown.innerHTML = '';
        if (results.length === 0) {
            dropdown.innerHTML = '<div style="padding: 10px; font-size: 13px; color: var(--text-secondary); text-align: center;">Ничего не найдено</div>';
            dropdown.style.display = 'block';
            return;
        }

        results.forEach(item => {
            const el = document.createElement('div');
            el.style.cssText = 'padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 1px solid var(--border-color);';
            el.textContent = item.display_name;
            el.onmouseenter = () => el.style.background = 'var(--table-row-hover)';
            el.onmouseleave = () => el.style.background = 'transparent';

            el.onclick = () => {
                selectedData = {
                    city_id: item.city_id,
                    street_id: item.street_id,
                    home_id: item.home_id,
                    object_id: item.id,
                    address: item.display_name
                };
                searchInput.value = item.display_name;
                dropdown.style.display = 'none';
                onChange(selectedData);
            };
            dropdown.appendChild(el);
        });
        dropdown.style.display = 'block';
    }

    // Закрытие при клике вне
    function onDocClick(e) {
        if (!searchWrap.contains(e.target)) dropdown.style.display = 'none';
    }
    document.addEventListener('click', onDocClick);

    // Запускаем загрузку городов
    loadCities();

    return {
        element: wrap,
        getValue: () => selectedData,
        isValid: () => selectedData !== null,
        setValue: (val) => {
            // Для редактирования (если понадобится)
            if (!val) return;
            citySelect.value = val.city_id;
            handleCityChange();
            searchInput.value = val.address;
            selectedData = val;
            onChange(selectedData);
        },
        destroy: () => {
            document.removeEventListener('click', onDocClick);
            if (debounceTimer) clearTimeout(debounceTimer);
        }
    };
}