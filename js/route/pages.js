/**
 * Шаблон А: Главная страница (Журнал «Открытые заявки»)
 */
/**
 * Шаблон А: Главная страница (Универсальный журнал для открытых и закрытых заявок)
 */
export function mainPageTemplate() {
    return `
    <div class="container">
        <div class="search-container" style="display: flex; gap: 10px; align-items: center; margin-bottom: 1rem; max-width: 600px;">
            <input type="text" id="searchInput" class="search-input" placeholder="Поиск по видимым колонкам..." style="flex: 1; max-width: 350px;">
            
            <!-- Сюда динамически инжектируется выбор дней для закрытых заявок -->
            <div id="periodSelectorContainer" style="display: flex; align-items: center;"></div>

            <button id="refreshBtn" class="theme-toggle-btn" title="Перезагрузить данные">
                <svg viewBox="0 0 24 24" style="width: 20px; height: 24px; fill: currentColor;">
                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.07 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
            </button>
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

// Функции createPageTemplate и detailsPageTemplate остаются прежними...


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
 * СИНХРОНИЗИРОВАНО: Ссылки и контейнеры подготовлены под динамический инжект DetailsController
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
