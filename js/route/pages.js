/**
 * Шаблон А: Главная страница (Универсальный журнал для открытых и закрытых заявок)
 */
export function mainPageTemplate() {
    return `
    <div class="container">
                <div class="search-container" style="display: flex; gap: 10px; align-items: center; margin-bottom: 1rem; max-width: 100%; flex-wrap: wrap;">
            <input type="text" id="searchInput" class="search-input" placeholder="Поиск по видимым колонкам..." style="flex: 1; min-width: 200px;">
            
            <!-- Фильтры для открытых заявок -->
            <div id="openOnlyFilters" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                
                <!-- Дропдаун городов -->
                <div class="city-filter-wrapper" style="position: relative;">
                    <button id="cityFilterBtn" class="search-input" style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 0.75rem 1rem; background: var(--bg-secondary); border: 2px solid var(--border-color); border-radius: 8px;">
                        <span id="cityFilterText">Города: Все</span>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                    </button>
                    <div id="cityFilterDropdown" class="user-dropdown" style="display: none; width: 250px; padding: 10px 0; max-height: 300px; overflow-y: auto;">
                        <div style="padding: 0 12px 8px 12px; border-bottom: 1px solid var(--border-color); margin-bottom: 5px;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600;">
                                <input type="checkbox" id="citySelectAll"> Выбрать / Снять все
                            </label>
                        </div>
                        <div id="cityCheckboxList" style="display: flex; flex-direction: column; gap: 5px; padding: 0 12px;"></div>
                    </div>
                </div>

                <!-- Чекбокс долгосрочных заявок -->
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; background: var(--bg-secondary); padding: 0.75rem 1rem; border: 2px solid var(--border-color); border-radius: 8px;">
                    <input type="checkbox" id="hideLongRepair">
                    <span id="hideLongRepairLabel"></span>
                </label>
            </div>

            <!-- Контейнер для селектора периода (только для закрытых) -->
            <div id="periodSelectorContainer" style="display: flex; align-items: center;"></div>

            <!-- Кнопка обновления / синхронизации -->
            <div style="position: relative; display: flex;">
                <button id="refreshBtn" class="theme-toggle-btn" title="Перезагрузить данные" style="position: relative;">
                    <svg viewBox="0 0 24 24" style="width: 20px; height: 24px; fill: currentColor;">
                        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.07 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                </button>
                <span id="syncBadge" style="display: none; position: absolute; top: -5px; right: -8px; background: #ef4444; color: white; border-radius: 50%; padding: 2px 6px; font-size: 10px; font-weight: 700; border: 2px solid var(--bg-primary); box-shadow: 0 2px 4px rgba(0,0,0,0.2);">0</span>
            </div>
        </div>

        <div class="table-wrapper">
            <table id="dataTable">
                <thead>
                    <tr></tr>
                </thead>
                <tbody></tbody>
            </table>
            <div id="noResults">Ничего не найдено по вашему запросу</div>
        </div>
    </div>`;
}

/**
 * Шаблон Б: Страница создания новой заявки (#/create)
 */
export function createPageTemplate() {
    return `
    <div class="container" style="max-width: 600px;">
        <h1 style="margin-bottom: 1.5rem;">Регистрация новой неисправности</h1>
<div class="table-wrapper create-form-wrapper" style="padding: 2rem; display: flex; flex-direction: column; gap: 15px;">
            <div>
    <!-- Компонент AddressPicker сам отрисует свои label'ы и инпуты -->
    <div id="formAddressSlot"></div>
    <div id="formAddressHint" style="display: none; font-size: 12px; color: var(--accent); margin-top: 4px; font-style: italic;"></div>
</div>
            <div>
    <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Описание проблемы *</label>
    <div id="formDetailsRow" style="display: flex; gap: 8px; align-items: flex-start;">
        <textarea id="formDetails" class="search-input" style="height: 100px; resize: none; flex: 1;" placeholder="Нет связи, кабина стоит..."></textarea>
    </div>
    <div id="capsWarnFormDetails" style="display: none; color: #ef4444; font-size: 12px; margin-top: 4px;">⚠️ Слишком много заглавных букв подряд (максимум 4)</div>
</div>
                                  <div>
                <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Назначить ответственного</label>
                <div id="formStaffSlot"></div>
            </div>
                                  <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                    <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Отдел *</label>
                    <div id="createDeptSlot"></div>
                </div>
                <div>
                    <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Тип запроса *</label>
                    <div id="createReqSlot"></div>
                </div>
                <div>
                    <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Группа *</label>
                    <div id="createGroupSlot"></div>
                </div>
            </div>
                        <div>
                <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Предполагаемое окончание ремонта</label>
                <div id="repairTimeSlot"></div>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <button id="saveTicketBtn" class="theme-toggle-btn" style="border-radius: 8px; width: auto; padding: 0 20px; font-size: 14px; background: var(--accent); color: var(--mark-text); font-weight: 600;">Сохранить заявку</button>
                <button id="cancelFormBtn" class="theme-toggle-btn" style="border-radius: 8px; width: auto; padding: 0 20px; font-size: 14px;">Отмена</button>
            </div>
        </div>
    </div>`;
}

/**
 * Шаблон В: Карточка детальной истории инцидента (#/ticket/:id)
 */
export function detailsPageTemplate(ticketId) {
    return `<div id="ticketDetailsDynamicContainer" style="width: 100%; flex: 1; min-height: 0; display: flex; flex-direction: column;"></div>`;
}

/**
 * Шаблон Г: Страница авторизации (#/login)
 */
export function loginPageTemplate() {
    return `
    <div class="container" style="max-width: 400px; margin: 0 auto; display: flex; align-items: center; justify-content: center; min-height: 60vh;">
        <div class="table-wrapper" style="padding: 2rem; width: 100%;">
            <h1 style="font-size: 1.5rem; margin-bottom: 1.5rem; text-align: center;">Вход в систему</h1>
            <form id="loginForm" style="display: flex; flex-direction: column; gap: 14px;">
                <div>
                    <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Логин</label>
                    <input type="text" id="loginName" class="search-input" autocomplete="username" required>
                </div>
                <div>
                    <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Пароль</label>
                    <input type="password" id="loginPassword" class="search-input" autocomplete="current-password" required>
                </div>
                <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer;">
                    <input type="checkbox" id="loginAutoLogin" checked>
                    <span>Запомнить меня (30 дней)</span>
                </label>
                <div id="loginError" style="display: none; color: #ef4444; font-size: 13px; padding: 8px 12px; background: rgba(239,68,68,0.1); border: 1px solid #ef4444; border-radius: 6px;"></div>
                <button type="submit" id="loginSubmit" class="theme-toggle-btn" style="border-radius: 8px; width: 100%; padding: 12px; font-size: 14px; background: var(--accent); color: var(--mark-text); font-weight: 600;">Войти</button>
            </form>
        </div>
    </div>`;
}

/**
 * Шаблон Д: Страница настроек и личного кабинета (#/settings)
 */
export function settingsPageTemplate() {
    return `
    <div class="container" style="max-width: 800px;">
        <h1 style="margin-bottom: 1.5rem;">Личный кабинет и настройки</h1>
        
        <div class="table-wrapper" style="padding: 2rem; display: flex; flex-direction: column; gap: 25px;">
            
            <!-- Блок Профиля -->
            <div style="border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
                <h3 style="margin-bottom: 15px;">👤 Личные данные</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
                    <div>
                        <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Фамилия</label>
                        <input type="text" id="profSurname" class="search-input" style="width: 100%;">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Имя</label>
                        <input type="text" id="profName" class="search-input" style="width: 100%;">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Отчество</label>
                        <input type="text" id="profPatronymic" class="search-input" style="width: 100%;">
                    </div>
                </div>
            </div>

            <!-- Блок Смены Пароля -->
            <div style="border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
                <h3 style="margin-bottom: 15px;">🔒 Смена пароля</h3>
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">Оставьте поля пустыми, если не хотите менять пароль.</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Текущий пароль</label>
                        <input type="password" id="profPassOld" class="search-input" style="width: 100%;">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Новый пароль</label>
                        <input type="password" id="profPassNew" class="search-input" style="width: 100%;">
                    </div>
                </div>
            </div>

            <!-- Блок Настроек Таблицы (Раскрывающийся) -->
            <details style="border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
                <summary style="cursor: pointer; font-size: 1.17em; font-weight: bold; margin-bottom: 15px; outline: none; user-select: none; display: flex; align-items: center; gap: 8px;">
                    📊 Настройка таблицы
                </summary>
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px; padding-top: 10px;">
                    Используйте стрелки для изменения порядка колонок. Колонки «№» и «Адрес» зафиксированы.
                </p>
                <div id="columnsSettingsList" style="display: flex; flex-direction: column; gap: 8px;">
                    <!-- Сюда рендерятся колонки -->
                </div>
            </details>

            <!-- Блок Локальных настроек (Город и Кэш) -->
            <div style="border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
                <h3 style="margin-bottom: 15px;">⚙️ Локальные настройки устройства</h3>
                
                <div style="margin-bottom: 15px;">
                    <label style="display:block; margin-bottom: 5px; font-size: 13px; color: var(--text-secondary);">Город по умолчанию (для формы создания)</label>
                    <div style="display: flex; gap: 10px;">
                        <select id="settingsDefaultCity" class="search-input" style="flex: 1; max-width: 300px;"></select>
                        <button id="saveDefaultCityBtn" class="menu-item active" style="padding: 0 16px; border-radius: 6px; border: none; cursor: pointer;">Сохранить город</button>
                    </div>
                </div>

                <div>
                    <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">Если адреса перестали отображаться или вышли новые справочники, очистите кэш.</p>
                    <button id="clearAddressCacheBtn" class="menu-item" style="padding: 8px 16px; border-radius: 6px; border: 1px solid #ef4444; color: #ef4444; background: transparent; cursor: pointer;">Очистить кэш адресов</button>
                </div>
            </div>

            <!-- Глобальная Кнопка Сохранения (Профиль + Колонки) -->
            <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                <button id="saveSettingsBtn" class="theme-toggle-btn" style="border-radius: 8px; width: auto; padding: 10px 24px; font-size: 14px; background: var(--accent); color: var(--mark-text); font-weight: 600;">Сохранить профиль и настройки таблицы</button>
            </div>

        </div>
    </div>`;
}