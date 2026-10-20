import { staffStore } from './staff-store.js';
import { userStore } from './user-store.js';
import { createDictSelect } from './components/dict-select.js';
import { createStaffSelect } from './components/staff-select.js';
import { logHistoryAction } from './history-logger.js';
import { createValidatedTextarea } from './components/validated-textarea.js';
import { createRepairTimePicker } from './components/repair-time-picker.js';
import { initVoiceTextarea, destroyVoiceInput } from './components/voiceInput.js';
import { notify } from './components/notify.js';
import { VALIDATION, UI, BUSINESS } from './config.js';
import { appState } from './app-state.js';
import { escapeHtml } from './utils/escape-html.js';
import { offlineDB } from './offline-db.js';
// Локальные алиасы — чтобы минимизировать правки ниже по файлу
const CAPS_REGEX = VALIDATION.CAPS_REGEX;
const MIN_SOLUTION_LEN = VALIDATION.MIN_SOLUTION_LEN;
const AUTO_RETURN_MS = UI.AUTO_RETURN_MS;
const ERROR_UNLOCK_MS = UI.ERROR_UNLOCK_MS;
const NOTIFY_CHANNELS = BUSINESS.NOTIFY_CHANNELS;
const ACCEPT_CHANNEL = BUSINESS.ACCEPT_CHANNEL;


export class DetailsController {
    constructor(apiInstance, routerInstance) {
        this.api = apiInstance;
        this.router = routerInstance;
        this.currentTicketId = null;
        this.ticket = null;
        this.deptSelect = null;
        this.reqSelect = null;
        this.groupSelect = null;
        this.pendingChanges = {};
        this.mode = 'view'; // 'view' | 'edit' | 'close'
        this.autoReturnTimer = null;

        // Состояние состава ответственных в текущем сеансе редактирования
        this._staffChangedInSession = false;   // было добавление/снятие → блок лимита
        this._autoOpenPending = false;         // автооткрыть форму в пустом слоте 1
        // Снапшот staff-полей на момент входа в edit.
        // Нужен, чтобы «Отмена» откатывала изменения в this.ticket,
        // которые в противном случае мутируют объект в openTicketsArray.
        this._ticketSnapshot = null;
    }

    async mount(ticketId, combinedTicketsArray = []) {
        this.currentTicketId = ticketId;
        this.pendingChanges = {};
        this.mode = 'view';

        const container = document.getElementById('ticketDetailsDynamicContainer');
        if (!container) return;

        // --- ПРОВЕРКА НА ОФЛАЙН-ЗАЯВКУ ---
        if (String(ticketId).startsWith('offline_')) {
            const outbox = await offlineDB.getAllFromOutbox();
            const found = outbox.find(o => o.uuid === ticketId);
            if (found) {
                this.ticket = {
                    ...found.payload,
                    id: found.uuid,
                    isOffline: true,
                    date: new Date(found.created_at).toLocaleString('ru')
                };
                this._renderCard(container);
                return;
            }
        }

        let ticket = combinedTicketsArray.find(t => String(t.id) === String(ticketId));
        if (!ticket) {
            ticket = await this._fetchTicketFromServer(ticketId);
            // Если пользователь ушёл со страницы, пока шёл запрос, отменяем рендер
            if (this.currentTicketId !== ticketId) return;
        }

        if (!ticket) {
            this._render404(container, ticketId);
            return;
        }

        this.ticket = ticket;
        this._renderCard(container);
    }
    /**
     * После успешного calledit — тихо подтягивает свежий снапшот заявки
     * и обновляет поля ответственных (там серверные notify_date).
     * Режим редактирования и открытые формы не трогает.
     */
    async _refreshTicketAfterSave() {
        try {
            const fresh = await this._fetchTicketFromServer(this.ticket.id);
            if (!fresh) return;

            const fields = [
                'staff_name',  'staff_phone',  'notify_status',  'notify_date',
                'staff_name2', 'staff_phone2', 'notify_status2', 'notify_date2',
                'staff_name3', 'staff_phone3', 'notify_status3', 'notify_date3'
            ];
            fields.forEach(key => {
                if (key in fresh) this.ticket[key] = fresh[key];
            });

            this._renderStaffSlots();
        } catch (err) {
            console.error('[DetailsController] Refresh after save error:', err);
        }
    }
    async _fetchTicketFromServer(ticketId) {
        try {
            const openData = await this.api.post({ data: 'open' }, 'Загрузка карточки №' + ticketId + '...', 'details');
            // Игнорируем намеренную отмену запроса
            if (openData && openData.code === 'aborted') return null;
            if (Array.isArray(openData)) {
                const found = openData.find(t => String(t.id) === String(ticketId));
                if (found) { found.type = 'open'; return found; }
            }
            const closeData = await this.api.post({ data: 'close', period: '7' }, 'Поиск в архиве...', 'details');
            // Игнорируем намеренную отмену запроса
            if (openData && openData.code === 'aborted') return null;
            if (Array.isArray(closeData)) {
                const found = closeData.find(t => String(t.id) === String(ticketId));
                if (found) { found.type = 'close'; return found; }
            }
        } catch (err) {
            console.error('[DetailsController] Ошибка загрузки с сервера:', err);
        }
        return null;
    }
    /**
     * Список полей заявки, которые могут меняться в edit-режиме
     * (состав ответственных и их статусы). Используется для снапшота.
     */
    /**
     * Все поля заявки, которые могут меняться в режиме редактирования.
     * Используется для снапшота: снимок → откат при «Отмене».
     */
    _getTicketSnapshotKeys() {
        return [
            // Основное описание
            'details',
            // Дата ремонта
            'repair_time',
            // Справочники (id + отображаемое имя)
            'department_id', 'department',
            'request_id',    'request',
            'group_id',      'group',
            // Принятое решение (для режима закрытия)
            'solution',
            // Три ответственных — все поля
            'staff_id',   'staff_name',   'staff_phone',   'notify_status',   'notify_date',
            'staff_id2',  'staff_name2',  'staff_phone2',  'notify_status2',  'notify_date2',
            'staff_id3',  'staff_name3',  'staff_phone3',  'notify_status3',  'notify_date3'
        ];
    }
    _formatLocalDateTime() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
            '@' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    _render404(container, ticketId) {
        container.innerHTML = `
            <div class="error-card" style="padding: 2rem; text-align: center; background: var(--bg-secondary); border: 2px solid var(--border-color); border-radius: 12px; max-width: 500px; margin: 2rem auto;">
                <h2 style="color: #ef4444;">Инцидент №${escapeHtml(ticketId)} не найден</h2>
                <p style="color: var(--text-secondary); margin: 1rem 0;">Возможно, заявка удалена или введён неверный номер.</p>
                <button class="menu-item active" id="backToTableBtn" style="border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer;">Вернуться в журнал</button>
            </div>`;
        const btn = document.getElementById('backToTableBtn');
        if (btn) btn.onclick = () => this.router.navigate('#/');
    }

    // ======================================================================
    // РЕНДЕР КАРТОЧКИ
    // ======================================================================

    _renderCard(container) {
        const t = this.ticket;
        const isOffline = t.isOffline === true;

        const isOpen = t.type !== 'close';
        const isClosed = t.type === 'close';

        const isAssigned = userStore.isAssignedTo(t, userStore.userId);
        const canEdit = userStore.can('add_details', { isAssigned });
        const canAssign = userStore.can('assign_staff');
        const canClose = isOpen && (
            userStore.can('close_ticket', { isAssigned }) ||
            Number(t.closureallowed) === 1
        );

        const statusLabel = isOpen ? 'В РАБОТЕ' : 'ЗАКРЫТА';
        const statusBg = isOpen ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)';
        const statusColor = isOpen ? '#ef4444' : '#22c55e';

        container.innerHTML = `
            <div class="ticket-card-layout-grid">

                               <!-- ЛЕВАЯ ПАНЕЛЬ: ПАРАМЕТРЫ -->
                                <div class="ticket-info-panel" style="background: var(--bg-secondary); border: 2px solid var(--border-color); border-radius: 12px; padding: 1.25rem 1rem 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; overflow: visible; height: 100%; min-height: 0; position: relative;">
                    <!-- Заголовок + статус — на разрыве верхней границы, как в блоке «История» -->
                    <div style="position: absolute; top: 0; left: 0; right: 0; transform: translateY(-50%); display: flex; justify-content: space-between; align-items: center; padding: 0 1.25rem; gap: 8px; z-index: 5;">
                        <h2 style="font-size: 1.1rem; font-weight: 700; background: var(--bg-primary); padding: 0 0.5rem; line-height: 1; margin: 0;">Заявка №${escapeHtml(t.id)}</h2>
                        <span style="font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 20px; background: ${statusBg}; color: ${statusColor}; border: 2px solid var(--bg-primary);">${statusLabel}</span>
                    </div>

                                        <div class="info-group" style="flex-shrink: 0;">
                        <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">📍 Адрес объекта</label>
                        <div style="font-size: 15px; font-weight: 600; margin-top: 2px; white-space: normal;">${escapeHtml(t.address || '—')}</div>
                    </div>

                    <!-- Плашка офлайн-режима -->
                    ${isOffline ? `
                    <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 8px; padding: 10px; color: #d97706; font-size: 13px; font-weight: 600; text-align: center; margin-top: 5px;">
                        ⏳ Заявка ожидает синхронизации с сервером. Редактирование недоступно.
                    </div>` : ''}
                        
                   

                    <!-- СКРОЛЛ-ЗОНА: всё, что между адресом и кнопками -->
                    <div id="ticketScrollArea" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; padding-right: 6px;">

                        <div id="ticketBodyBlock" style="display: flex; flex-direction: column; gap: 1rem;">

                            <div class="info-group">
                                <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">🚨 Описание проблемы</label>
                                <div id="detailsDisplay" style="font-size: 14px; margin-top: 2px; background: var(--bg-primary); padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); white-space: pre-wrap;">${escapeHtml(t.details || 'Описание отсутствует.')}</div>

                                <div id="detailsAddBlock" style="display: none; margin-top: 8px;">
                                    <textarea id="newDetailsInput" class="search-input editable-field" rows="3" placeholder="Введите дополнение к описанию..." style="width: 100%; resize: vertical; font-family: inherit;"></textarea>
                                    <div id="capsWarnDetails" style="display: none; color: #ef4444; font-size: 12px; margin-top: 4px;">⚠️ Слишком много заглавных букв подряд (максимум 4)</div>
                                    <button id="addDetailsBtn" class="menu-item" style="margin-top: 6px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); cursor: pointer;">+ Добавить описание заявки</button>
                                </div>
                            </div>

                            <div class="info-group" id="staffAssignmentsBlock">
                                <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">👷 Ответственные</label>
                                <div id="staffSlotsContainer" style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;"></div>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                                <div class="info-group">
                                    <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">📅 Дата регистрации</label>
                                    <div style="font-size: 14px; margin-top: 2px;">${escapeHtml(t.date || '—')}</div>
                                </div>
                                <div class="info-group">
                                    <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">🛠 Дата ремонта</label>
                                    <div id="repairTimeDisplay" style="font-size: 14px; margin-top: 2px;">${escapeHtml(t.repair_time || '—')}</div>
                                    <div id="repairTimeEditBlock" style="display: none; margin-top: 6px;"></div>
                                </div>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 1rem;">
                                <div class="info-group">
                                    <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">🏢 Отдел</label>
                                    <div id="deptDisplay" style="font-size: 14px; margin-top: 2px;">${escapeHtml(t.department || '—')}</div>
                                    <div id="deptEditBlock" style="display: none; margin-top: 6px;"></div>
                                </div>
                                <div class="info-group">
                                    <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">📋 Тип запроса</label>
                                    <div id="reqDisplay" style="font-size: 14px; margin-top: 2px;">${escapeHtml(t.request || '—')}</div>
                                    <div id="reqEditBlock" style="display: none; margin-top: 6px;"></div>
                                </div>
                                <div class="info-group">
                                    <label style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">📦 Группа</label>
                                    <div id="groupDisplay" style="font-size: 14px; margin-top: 2px;">${escapeHtml(t.group || '—')}</div>
                                    <div id="groupEditBlock" style="display: none; margin-top: 6px;"></div>
                                </div>
                            </div>

                            ${isClosed ? `
                            <div class="info-group" style="border-top: 1px dashed var(--border-color); padding-top: 1rem;">
                                <label style="font-size: 11px; font-weight: 700; color: #22c55e; text-transform: uppercase;">✅ Принятое решение</label>
                                <div style="font-size: 14px; margin-top: 2px; font-weight: 500; white-space: pre-wrap;">${escapeHtml(t.solution || '—')}</div>
                            </div>` : ''}

                        </div>
<div id="closeBlock" style="display: none; border-top: 1px dashed var(--border-color); padding-top: 1rem;">
    <label style="font-size: 11px; font-weight: 700; color: #22c55e; text-transform: uppercase;">🔒 Решение по заявке</label>
    <textarea id="solutionInput" class="search-input" rows="3" placeholder="Опишите, что было сделано (минимум ${MIN_SOLUTION_LEN} символов)..." style="width: 100%; resize: vertical; margin-top: 4px; font-family: inherit;"></textarea>
    <div id="capsWarnSolution" style="display: none; color: #ef4444; font-size: 12px; margin-top: 4px;">⚠️ Слишком много заглавных букв подряд (максимум 4)</div>

    <label id="closeAndCreateWrap" class="editable-field editable-field--checkbox" style="display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer; font-size: 13px; width: fit-content;">
        <input type="checkbox" id="closeAndCreateCheck" style="cursor: pointer;">
        <span>Закрыть и создать новую для этого объекта</span>
    </label>
</div>
                       
                        <div id="editErrorBanner" style="display: none; padding: 8px 12px; background: rgba(239,68,68,0.1); border: 1px solid #ef4444; border-radius: 8px; color: #ef4444; font-size: 13px;"></div>

                    </div>
                    <!-- /#ticketScrollArea -->

                    <!-- ФУТЕР: всегда внизу панели, не скроллится -->
                    <div class="ticket-actions-footer">
                        <button class="menu-item" id="backBtn" style="border: 2px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 600;">← Вернуться в журнал</button>
                        ${(!isOffline && isOpen && canEdit) ? `<button class="menu-item" id="editBtn" style="border: 2px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 600;">✏️ Редактировать</button>` : ''}
                        ${(!isOffline && canClose)  ? `<button class="menu-item" id="closeBtn" style="border: 2px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 600;">🔒 Закрыть заявку</button>` : ''}

                        <button class="menu-item " id="saveBtn" hidden disabled style="border: none; background: var(--accent); color: var(--mark-text); padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 700;">Сохранить</button>
                        <button class="menu-item hide-action-btn" id="cancelEditBtn" style="border: 2px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 600;">Отмена</button>
                    </div>

                </div>
                <!-- /.ticket-info-panel -->

                <!-- ПРАВАЯ ПАНЕЛЬ: КОММЕНТАРИИ -->
                                <div class="ticket-notes-panel" style="background: var(--bg-secondary); border: 2px solid var(--border-color); border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; min-height: 0; height: 100%; overflow: visible;">
                                    <h3 style="font-size: 1.25rem; border-bottom: 2px solid var(--border-color); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
                        <span>📝 Комментарии к заявке</span>
                        <span id="notesCountBadge" style="font-size: 12px; background: var(--border-color); padding: 2px 8px; border-radius: 10px; font-weight: 600;">0</span>
                    </h3>
                    <div id="notesContainerDOM" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 5px; margin-bottom: 8px; min-height: 0;"></div>

                    ${userStore.can('add_note', { isAssigned: userStore.isAssignedTo(t, userStore.userId) }) ? `
                    <div id="noteComposer" style="border-top: 1px dashed var(--border-color); padding-top: 10px; flex-shrink: 0;"></div>
                    ` : ''}
                </div>
                <!-- /.ticket-notes-panel -->

            </div>
            <!-- /.ticket-card-layout-grid -->
        `;

        this._renderStaffSlots();
        this._renderNotesList(t.note || []);
        this._renderNoteComposer();
        this._bindEvents();

    }

    // ======================================================================
    // ТРИ ОТВЕТСТВЕННЫХ — РЕНДЕР И ВЗАИМОДЕЙСТВИЕ
    // ======================================================================

    /** Возвращает массив слотов {slot: 1|2|3, id, name, notifyStatus, notifyDate} */
    _getStaffSlots() {
        const t = this.ticket;
        return [
            { slot: 1, id: t.staff_id, name: t.staff_name, notifyStatus: t.notify_status, notifyDate: t.notify_date },
            { slot: 2, id: t.staff_id2, name: t.staff_name2, notifyStatus: t.notify_status2, notifyDate: t.notify_date2 },
            { slot: 3, id: t.staff_id3, name: t.staff_name3, notifyStatus: t.notify_status3, notifyDate: t.notify_date3 }
        ];
    }

    /**
     * Читаемый заголовок слота.
     * Слот 1 — основной ответственный, слоты 2 и 3 — дополнительные.
     */
    _slotLabel(slotNumber) {
        if (slotNumber === 1) return 'Ответственный 1';
        return 'Доп. ответственный ' + slotNumber;
    }

    _renderStaffSlots() {
        const container = document.getElementById('staffSlotsContainer');
        if (!container) return;

        // Уничтожаем открытую форму выбора, если она была
        if (this.currentStaffSelect && typeof this.currentStaffSelect.destroy === 'function') {
            this.currentStaffSelect.destroy();
            this.currentStaffSelect = null;
        }

        container.innerHTML = '';

        const slots = this._getStaffSlots();
        const isOpen = this.ticket.type !== 'close';
        const isEdit = this.mode === 'edit';
        const isAdmin = userStore.isAdmin();
        const canAssign = isOpen && userStore.can('assign_staff');
        const isSessionLocked = this._staffChangedInSession;
        const isGridLocked = !!document.querySelector('.ticket-card-layout-grid.card-locked');

        // «Занят» ли слот с учётом pendingChanges
        const filled = slots.map((slot, idx) => {
            const keyId = 'staff_id' + (idx === 0 ? '' : (idx + 1));
            if (keyId in this.pendingChanges) {
                return this.pendingChanges[keyId] != null;
            }
            return slot.id != null;
        });

        // Progressive disclosure: слот i виден, если он занят,
        // ИЛИ все предыдущие слоты заняты
        const visible = slots.map((_, idx) => {
            if (filled[idx]) return true;
            for (let i = 0; i < idx; i++) {
                if (!filled[i]) return false;
            }
            return true;
        });

        // Индекс первого пустого среди видимых — для кнопки «+ Добавить»
        // и для автооткрытия формы
        let firstEmptyIdx = -1;
        for (let i = 0; i < slots.length; i++) {
            if (visible[i] && !filled[i]) { firstEmptyIdx = i; break; }
        }

        // Отрисовка строк
        slots.forEach((slot, idx) => {
            if (!visible[idx]) return;

            const slotNumber = idx + 1;

            if (filled[idx]) {
                this._renderFilledSlot(container, slot, slotNumber, {
                    isOpen, isEdit, isAdmin, canAssign, isGridLocked
                });
            } else {
                this._renderEmptySlot(container, slotNumber, idx, {
                    isEdit, canAssign, isSessionLocked, isGridLocked, firstEmptyIdx
                });
            }
        });

        // Автооткрытие формы — только в первом пустом слоте.
        // Срабатывает один раз, флаг сразу гасится.
        if (this._autoOpenPending && isEdit && firstEmptyIdx === 0 && canAssign && !isGridLocked) {
            this._autoOpenPending = false;
            setTimeout(() => this._openAssignForm(1), 0);
        }
    }
    /**
     * Отрисовка занятого слота: ФИО + телефон, статус, чекбокс,
     * кнопки «Заменить» / «Снять» (по правилам роли), кнопка «Принял».
     */
    _renderFilledSlot(container, slot, slotNumber, ctx) {
        const { isOpen, isEdit, isAdmin, canAssign, isGridLocked } = ctx;
        const suffix = slotNumber === 1 ? '' : slotNumber;

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary);';

        // Голова: имя + метка слота
        const head = document.createElement('div');
        head.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 8px;';

        const phoneFromTicket = this.ticket['staff_phone' + suffix];
        const phone = phoneFromTicket || staffStore.getPhone(slot.id);

        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'font-weight: 600; font-size: 14px;';
        nameEl.textContent = (slotNumber === 1 ? '★ ' : '· ') + (slot.name || '—');
        if (phone) {
            nameEl.title = '📞 ' + phone;
            nameEl.style.cursor = 'help';
        }
        head.appendChild(nameEl);

        const labelEl = document.createElement('span');
        labelEl.style.cssText = 'font-size: 11px; color: var(--text-secondary);';
        labelEl.textContent = this._slotLabel(slotNumber);
        head.appendChild(labelEl);

        row.appendChild(head);

        // Строка статуса
        const status = document.createElement('div');
        status.style.cssText = 'font-size: 12px; color: var(--text-secondary);';
        const channel = NOTIFY_CHANNELS[slot.notifyStatus] || '— Не уведомлён —';

        if (!slot.notifyStatus) {
            status.textContent = '— Не уведомлён —';
        } else if (slot.notifyDate) {
            status.textContent = `${channel} · ${slot.notifyDate}`;
        } else {
            status.textContent = `${channel} · будет зафиксировано при сохранении`;
            status.style.fontStyle = 'italic';
            status.style.color = 'var(--accent)';
        }
        row.appendChild(status);

        // Чекбокс статуса — свеженазначенным диспетчеру, любым админу
        const keyStaffId = 'staff_id' + suffix;
        const isNewlyAssigned = keyStaffId in this.pendingChanges;

        if (isEdit && (isAdmin || (isNewlyAssigned && canAssign))) {
            const notifyWrap = document.createElement('label');
            notifyWrap.className = 'editable-field editable-field--checkbox';
            notifyWrap.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; margin-top: 6px; cursor: pointer; font-size: 12px; width: fit-content;';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.style.cursor = 'pointer';
            cb.checked = slot.notifyStatus === 1;

            const txt = document.createElement('span');
            txt.textContent = 'Уведомлён по телефону';

            cb.onchange = () => {
                const keyNotify = 'notify_status' + suffix;
                const keyNotifyDate = 'notify_date' + suffix;
                if (cb.checked) {
                    this.pendingChanges[keyNotify] = 1;
                    this.ticket[keyNotify] = 1;
                    this.ticket[keyNotifyDate] = this._formatLocalDateTime();
                } else {
                    this.pendingChanges[keyNotify] = 0;
                    this.ticket[keyNotify] = 0;
                    this.ticket[keyNotifyDate] = null;
                }
                this._renderStaffSlots();
                this._updateSaveButtonState();
            };

            notifyWrap.appendChild(cb);
            notifyWrap.appendChild(txt);
            row.appendChild(notifyWrap);
        }

        // Кнопки замены / снятия
        const canReplace = isEdit && !isGridLocked && (isAdmin || (isNewlyAssigned && canAssign));
        const canUnassign = isEdit && !isGridLocked && isAdmin;

        if (canReplace || canUnassign) {
            const actionsRow = document.createElement('div');
            actionsRow.style.cssText = 'display: flex; gap: 6px; margin-top: 6px;';

            if (canReplace) {
                const replaceBtn = document.createElement('button');
                replaceBtn.textContent = '✏️ Заменить';
                replaceBtn.style.cssText = 'padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: 11px;';
                replaceBtn.onclick = () => this._openReplaceForm(slotNumber);
                actionsRow.appendChild(replaceBtn);
            }

            if (canUnassign) {
                const unassignBtn = document.createElement('button');
                unassignBtn.textContent = '× Снять';
                unassignBtn.style.cssText = 'padding: 4px 10px; border-radius: 6px; border: 1px solid #ef4444; background: transparent; color: #ef4444; cursor: pointer; font-size: 11px;';
                unassignBtn.onclick = () => this._onUnassignStaff(slotNumber);
                actionsRow.appendChild(unassignBtn);
            }

            row.appendChild(actionsRow);
        }

        // Кнопка «Принял в работу (WEB)» для механика на своём слоте
        const isMySlot = String(slot.id) === String(userStore.userId);
        if (isOpen && isMySlot && !slot.notifyStatus && userStore.isEngineer()) {
            const acceptBtn = document.createElement('button');
            acceptBtn.textContent = '✓ Принял в работу (WEB)';
            acceptBtn.style.cssText = 'margin-top: 4px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); cursor: pointer; font-size: 12px; font-weight: 600;';
            acceptBtn.onclick = () => this._onAcceptAssignment(slotNumber);
            row.appendChild(acceptBtn);
        }

        container.appendChild(row);
    }

    /**
     * Отрисовка пустого слота: заголовок «не назначен» + кнопка «+ Добавить»
     * (если пользователь имеет право, ещё не менял состав в этой сессии
     * и это первый пустой слот).
     */
    _renderEmptySlot(container, slotNumber, idx, ctx) {
        const { isEdit, canAssign, isSessionLocked, isGridLocked, firstEmptyIdx } = ctx;

        const row = document.createElement('div');
        row.classList.add('staff-slot-empty');
        row.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary);';

        const head = document.createElement('div');
        head.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 8px;';
        head.innerHTML = `
            <span style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">${this._slotLabel(slotNumber)}</span>
            <span class="staff-slot-empty-label" style="font-size: 11px; font-style: italic;">не назначен</span>
        `;
        row.appendChild(head);

        // Кнопка «+ Добавить» — только если:
        //   edit-mode, есть право, состав ещё не менялся, не заблокировано,
        //   и это первый пустой слот
        const canAddHere =
            isEdit && canAssign && !isSessionLocked && !isGridLocked &&
            idx === firstEmptyIdx;

        if (canAddHere) {
            const addBtn = document.createElement('button');
            addBtn.textContent = '+ Добавить';
            addBtn.style.cssText = 'margin-top: 4px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: 12px;';
            addBtn.onclick = () => this._openAssignForm(slotNumber);
            row.appendChild(addBtn);
        }

        container.appendChild(row);
    }
    /**
     * Открывает инлайн-форму назначения ответственного в указанный слот.
     * Заменяет содержимое строки на селект сотрудника + селект канала уведомления.
     */
    /**
     * Открывает инлайн-форму назначения ответственного в указанный слот.
     * Диспетчер и админ могут только отметить чекбокс «Уведомлён по телефону».
     */
    /**
     * Снять ответственного из слота.
     * Помечает staff_id как null и обнуляет статус.
     * На сервер уйдёт в calledit как staff_idN: null.
     */
    _onUnassignStaff(slotNumber) {
        const suffix = slotNumber === 1 ? '' : slotNumber;

        const keyId = 'staff_id' + suffix;
        const keyName = 'staff_name' + suffix;
        const keyPhone = 'staff_phone' + suffix;
        const keyNotify = 'notify_status' + suffix;
        const keyNotifyDate = 'notify_date' + suffix;

        // Помечаем в pendingChanges: staff_id = null (сервер должен понять «снять»)
        this.pendingChanges[keyId] = null;
        this.pendingChanges[keyNotify] = 0;
// Снятие — это тоже изменение состава → лимит закрыт до конца сессии
        this._staffChangedInSession = true;
        // Локально очищаем UI
        this.ticket[keyId] = null;
        this.ticket[keyName] = null;
        this.ticket[keyPhone] = null;
        this.ticket[keyNotify] = null;
        this.ticket[keyNotifyDate] = null;

        this._renderStaffSlots();
        this._updateSaveButtonState();
    }

    /**
     * Заменить ответственного в занятом слоте.
     * Технически — тот же _openAssignForm, но семантически отдельный вызов.
     * Если позже понадобится другая логика для замены — правится здесь.
     */
    _openReplaceForm(slotNumber) {
        this._openAssignForm(slotNumber);
    }
    _openAssignForm(slotNumber) {
        // Собираем занятые ID во всех трёх слотах, чтобы исключить их из поиска
        const slots = this._getStaffSlots();
        const busyIds = slots
            .filter(s => s.slot !== slotNumber && s.id)
            .map(s => s.id);

        const rowIdx = slotNumber - 1;
        const container = document.getElementById('staffSlotsContainer');
        const row = container.children[rowIdx];
        if (!row) return;

        // Уничтожаем предыдущий компонент, если был
        if (this.currentStaffSelect && typeof this.currentStaffSelect.destroy === 'function') {
            this.currentStaffSelect.destroy();
        }

        row.innerHTML = '';

        // 1. Чекбокс «Уведомлён по телефону» — заранее, т.к. на него подписан onSelect
        const notifyWrap = document.createElement('label');
        notifyWrap.className = 'editable-field editable-field--checkbox';
        notifyWrap.style.cssText = 'display: none; align-items: center; gap: 8px; margin-top: 6px; cursor: pointer; font-size: 13px;';

        const notifyCheck = document.createElement('input');
        notifyCheck.type = 'checkbox';
        notifyCheck.style.cursor = 'pointer';

        const notifyText = document.createElement('span');
        notifyText.textContent = 'Уведомлён по телефону';

        notifyWrap.appendChild(notifyCheck);
        notifyWrap.appendChild(notifyText);

        // 2. Компонент выбора механика с поиском
        const staffSelect = createStaffSelect({
            list: staffStore.list,
            excludeIds: busyIds,
            placeholder: 'Начните вводить имя...',
            onSelect: (staff) => {
                const suffix = slotNumber === 1 ? '' : slotNumber;
                const keyId = 'staff_id' + suffix;

                // Чекбокс показываем, если слот был пуст («+ Добавить»)
                // ИЛИ если ответственный уже назначен в этом сеансе («Заменить» свеженазначенного).
                // Для сохранённых сервером чекбокс в форме не показываем —
                // их статус меняется отдельно, в самом слоте.
                const isNewOrReassign =
                    !this.ticket[keyId] || (keyId in this.pendingChanges);

                if (staff && isNewOrReassign) {
                    notifyWrap.style.display = 'inline-flex';
                } else {
                    notifyWrap.style.display = 'none';
                    notifyCheck.checked = false;
                }
            }
        });
        this.currentStaffSelect = staffSelect;

        // 3. Кнопки действий
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Подтвердить';
        confirmBtn.style.cssText = 'margin-top: 6px; padding: 6px 10px; border-radius: 6px; border: none; background: var(--accent); color: var(--mark-text); cursor: pointer; font-size: 12px; font-weight: 600;';
        confirmBtn.onclick = () => {
            const selectedId = staffSelect.getValue();
            if (!selectedId) return;

            const keyId = 'staff_id' + (slotNumber === 1 ? '' : slotNumber);
            const keyNotify = 'notify_status' + (slotNumber === 1 ? '' : slotNumber);
            const keyNotifyDate = 'notify_date' + (slotNumber === 1 ? '' : slotNumber);
            const keyName = 'staff_name' + (slotNumber === 1 ? '' : slotNumber);

            this.pendingChanges[keyId] = Number(selectedId);

            if (notifyCheck.checked) {
                this.pendingChanges[keyNotify] = 1;
                this.ticket[keyNotify] = 1;
                // Локальная дата для UI. На сервер не уходит — там своя.
                this.ticket[keyNotifyDate] = this._formatLocalDateTime();
            }

            this.ticket[keyId] = Number(selectedId);
            this.ticket[keyName] = staffStore.getById(selectedId)?.name || null;

            // Добавление/замена — состав изменён
            this._staffChangedInSession = true;
            this._autoOpenPending = false;

            staffSelect.destroy();
            this.currentStaffSelect = null;

            this._renderStaffSlots();
            this._updateSaveButtonState();
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Отмена';
        cancelBtn.style.cssText = 'margin-top: 6px; margin-left: 6px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: 12px;';
        cancelBtn.onclick = () => {
            staffSelect.destroy();
            this.currentStaffSelect = null;
            this._renderStaffSlots();
        };

        // 4. Сборка строки
        row.appendChild(staffSelect.element);
        row.appendChild(notifyWrap);
        row.appendChild(confirmBtn);
        row.appendChild(cancelBtn);

        // Фокус на поле поиска сразу после открытия
        setTimeout(() => staffSelect.focus(), 30);
    }

    /**
     * Быстрая отправка «Принял в работу» без формы редактирования.
     * Сразу шлёт calledit с notify_status = ACCEPT_CHANNEL для слота текущего механика.
     */
    async _onAcceptAssignment(slotNumber) {
        const keyNotify = 'notify_status' + (slotNumber === 1 ? '' : slotNumber);
        const payload = {
            action: 'calledit',
            call_id: this.ticket.id,
            [keyNotify]: ACCEPT_CHANNEL
        };

        try {
            const response = await this.api.post(payload, 'Отметка «Принял в работу»...', 'details');            if (response && response.status === 'ok') {
                this.ticket[keyNotify] = ACCEPT_CHANNEL;
                // Локальная дата для UI. Сервер вернёт свою при следующем fetch.
                this.ticket['notify_date' + (slotNumber === 1 ? '' : slotNumber)] = this._formatLocalDateTime();
                this._renderStaffSlots();
                const msg = response.message || 'Статус уведомления обновлён.';
                logHistoryAction(msg);
                notify.success(msg);
            } else {
                const msg = (response && response.message) || 'Не удалось обновить статус.';
                logHistoryAction(msg);
                notify.error(msg);
            }
        } catch (err) {
            console.error('[DetailsController] Accept error:', err);
            logHistoryAction('Сбой сети при отметке «Принял в работу».');
            notify.error('Не удалось обновить статус. Проверьте соединение.');
        }
    }

    // ======================================================================
    // ФОРМА РЕДАКТИРОВАНИЯ / ЗАКРЫТИЯ
    // ======================================================================

    _bindEvents() {
        const $ = id => document.getElementById(id);

        $('backBtn').onclick = () => this.router.navigate(this.ticket.type === 'close' ? '#/closed' : '#/');

        const editBtn = $('editBtn');
        if (editBtn) editBtn.onclick = () => this._enterEditMode();

        const closeBtn = $('closeBtn');
        if (closeBtn) closeBtn.onclick = () => this._enterCloseMode();

        $('cancelEditBtn').onclick = () => this._exitEditMode();

        const addDetailsBtn = $('addDetailsBtn');
        if (addDetailsBtn) addDetailsBtn.onclick = () => this._onAddDescription();

        const newDetailsInput = $('newDetailsInput');
        if (newDetailsInput) {
            newDetailsInput.oninput = () => this._checkCaps(newDetailsInput.value, $('capsWarnDetails'));
        }

        const solutionInput = $('solutionInput');
        if (solutionInput) {
            solutionInput.oninput = () => {
                this._checkCaps(solutionInput.value, $('capsWarnSolution'));
                this._updateSaveButtonState();
            };
        }

        $('saveBtn').onclick = () => this._onSave();
    }

    _enterEditMode() {
        this.mode = 'edit';

        // Снапшот всех редактируемых полей — для отката при «Отмене»
        this._ticketSnapshot = {};
        this._getTicketSnapshotKeys().forEach(k => {
            this._ticketSnapshot[k] = this.ticket[k] ?? null;
        });

        // Сбрасываем счётчик сессии при каждом входе в режим редактирования.
        // Автооткрытие формы — только если основной ответственный ещё не назначен.
        this._staffChangedInSession = false;
        this._autoOpenPending = (this.ticket.staff_id == null);

        document.getElementById('detailsAddBlock').style.display = 'block';
        document.getElementById('editBtn').style.display = 'none';
        // Голосовой ввод для textarea «Дополнить описание» — подключаем в момент показа
        const newDetailsInput = document.getElementById('newDetailsInput');
        if (newDetailsInput) initVoiceTextarea(newDetailsInput);
        const closeBtn = document.getElementById('closeBtn');
        if (closeBtn) closeBtn.style.display = 'none';
        document.getElementById('saveBtn').hidden = false;
        document.getElementById('cancelEditBtn').style.display = 'block';
        this._renderStaffSlots(); // перерисовать слоты, чтобы свободные показали «+ Добавить»
        // Справочники отдел / запрос / группа
        const dictRules = [
            { key: 'department', action: 'change_department', idField: 'department_id', ref: 'deptSelect',  blockId: 'deptEditBlock',  currentValue: this.ticket.department_id },
            { key: 'request',    action: 'change_request',    idField: 'request_id',    ref: 'reqSelect',   blockId: 'reqEditBlock',   currentValue: this.ticket.request_id },
            { key: 'group',      action: 'change_group',      idField: 'group_id',      ref: 'groupSelect', blockId: 'groupEditBlock', currentValue: this.ticket.group_id }
        ];

        dictRules.forEach(rule => {
            if (!userStore.can(rule.action, { currentValue: rule.currentValue })) return;

            const block = document.getElementById(rule.blockId);
            if (!block) return;
            block.style.display = 'block';

            if (!this[rule.ref]) {
                const comp = createDictSelect({
                    key: rule.key,
                    initialValue: rule.currentValue || null,
                    placeholder: '— выберите —',
                    required: true,
                    onChange: (value) => {
                        if (value) {
                            this.pendingChanges[rule.idField] = String(value);
                        } else {
                            delete this.pendingChanges[rule.idField];
                        }
                        this._updateSaveButtonState();
                    }
                });
                block.innerHTML = '';
                block.appendChild(comp.element);
                this[rule.ref] = comp;
            }
        });
        // Дата ремонта — только для admin/dispatcher
        const isAssigned = userStore.isAssignedTo(this.ticket, userStore.userId);
        if (userStore.can('set_repair_time', { isAssigned })) {
            const block = document.getElementById('repairTimeEditBlock');
            if (block) {
                block.style.display = 'block';
                if (!this.repairPicker) {
                    this.repairPicker = createRepairTimePicker({
                        initialValue: this.ticket.repair_time,
                        onChange: (value) => {
                            this.pendingChanges.repair_time = value;
                            this._updateSaveButtonState();
                        }
                    });
                    block.innerHTML = '';
                    block.appendChild(this.repairPicker.element);
                }
            }
        }

        this._updateSaveButtonState();
    }

    _enterCloseMode() {
        this.mode = 'close';

        // Скрываем тело карточки (описание, ответственные, даты, принятое решение)
        const bodyBlock = document.getElementById('ticketBodyBlock');
        if (bodyBlock) bodyBlock.style.display = 'none';

        document.getElementById('closeBlock').style.display = 'block';
        // Сброс галочки «создать новую для этого объекта» при каждом входе в режим
        const closeAndCreateCheck = document.getElementById('closeAndCreateCheck');
        if (closeAndCreateCheck) closeAndCreateCheck.checked = false;
        // Голосовой ввод для textarea «Решение по заявке» — в момент показа
        const solutionInput = document.getElementById('solutionInput');
        if (solutionInput) initVoiceTextarea(solutionInput);

        document.getElementById('editBtn').style.display = 'none';
        const closeBtn = document.getElementById('closeBtn');
        if (closeBtn) closeBtn.style.display = 'none';
        document.getElementById('saveBtn').hidden = false;
        document.getElementById('cancelEditBtn').style.display = 'block';

        setTimeout(() => {
            const ta = document.getElementById('solutionInput');
            if (ta) ta.focus();
        }, 50);

        this._updateSaveButtonState();
    }

    _exitEditMode() {
        // Микрофон остановится, если он был активен
        destroyVoiceInput();

        // Откатываем все редактируемые поля из снапшота.
        // Иначе мутации this.ticket «протекут» в openTicketsArray
        // и в следующую сессию редактирования.
        if (this._ticketSnapshot) {
            this._getTicketSnapshotKeys().forEach(k => {
                this.ticket[k] = this._ticketSnapshot[k];
            });
            this._ticketSnapshot = null;
        }

        this.pendingChanges = {};
        this.mode = 'view';
        this._staffChangedInSession = false;
        this._autoOpenPending = false;
// Возвращаем тело карточки (после отмены закрытия или редактирования)
        const bodyBlock = document.getElementById('ticketBodyBlock');
        if (bodyBlock) bodyBlock.style.display = 'flex';
        document.getElementById('detailsAddBlock').style.display = 'none';
        document.getElementById('closeBlock').style.display = 'none';
        document.getElementById('saveBtn').hidden = true;
        document.getElementById('cancelEditBtn').style.display = 'none';
        const editBtn = document.getElementById('editBtn');
        if (editBtn) editBtn.style.display = 'block';
        const closeBtn = document.getElementById('closeBtn');
        if (closeBtn) closeBtn.style.display = 'block';

        const newDetailsInput = document.getElementById('newDetailsInput');
        if (newDetailsInput) newDetailsInput.value = '';
        const solutionInput = document.getElementById('solutionInput');
        if (solutionInput) solutionInput.value = '';
        const capsWarnDetails = document.getElementById('capsWarnDetails');
        if (capsWarnDetails) capsWarnDetails.style.display = 'none';
        const capsWarnSolution = document.getElementById('capsWarnSolution');
        if (capsWarnSolution) capsWarnSolution.style.display = 'none';

        // Восстанавливаем данные карточки из сохранённой копии тикета
        // Восстанавливаем данные карточки из сохранённой копии тикета
        const display = document.getElementById('detailsDisplay');
        if (display) display.textContent = this.ticket.details || 'Описание отсутствует.';

        // Скрываем блок даты ремонта и сбрасываем пикер
        const repairBlock = document.getElementById('repairTimeEditBlock');
        if (repairBlock) repairBlock.style.display = 'none';
        if (this.repairPicker) this.repairPicker.reset();
        // Скрываем и сбрасываем селекты справочников
        [
            { blockId: 'deptEditBlock',  ref: 'deptSelect',  displayId: 'deptDisplay',  field: 'department' },
            { blockId: 'reqEditBlock',   ref: 'reqSelect',   displayId: 'reqDisplay',   field: 'request' },
            { blockId: 'groupEditBlock', ref: 'groupSelect', displayId: 'groupDisplay', field: 'group' }
        ].forEach(item => {
            const block = document.getElementById(item.blockId);
            if (block) block.style.display = 'none';
            if (this[item.ref]) this[item.ref].reset();
            const display = document.getElementById(item.displayId);
            if (display) display.textContent = this.ticket[item.field] || '—';
        });

        // Восстанавливаем отображение даты ремонта
        const repairDisplay = document.getElementById('repairTimeDisplay');
        if (repairDisplay) repairDisplay.textContent = this.ticket.repair_time || '—';

        this._renderStaffSlots();
    }

    _onAddDescription() {
        const input = document.getElementById('newDetailsInput');
        const text = input.value.trim();
        if (!text || CAPS_REGEX.test(text)) return;

        const currentDetails = this.pendingChanges.details !== undefined
            ? this.pendingChanges.details
            : (this.ticket.details || '');

        const separator = currentDetails ? '\n\n' : '';
        this.pendingChanges.details = currentDetails + separator + '📝 Дополнение: ' + text;

        const display = document.getElementById('detailsDisplay');
        if (display) display.textContent = this.pendingChanges.details;

        input.value = '';
        this._updateSaveButtonState();
    }

    _checkCaps(text, warnEl) {
        const hasCaps = CAPS_REGEX.test(text);
        if (warnEl) warnEl.style.display = hasCaps ? 'block' : 'none';
        this._updateSaveButtonState();
    }

    _updateSaveButtonState() {
        const saveBtn = document.getElementById('saveBtn');
        if (!saveBtn || saveBtn.classList.contains('btn-loading') ||
            saveBtn.classList.contains('btn-success') ||
            saveBtn.classList.contains('btn-error')) return;

        const $ = id => document.getElementById(id);
        let enabled = false;

        if (this.mode === 'edit') {
            enabled = Object.keys(this.pendingChanges).length > 0;
            const newDetails = $('newDetailsInput');
            if (newDetails && CAPS_REGEX.test(newDetails.value)) enabled = false;
            if (this.repairPicker && !this.repairPicker.isValid()) enabled = false;
            // Селекты справочников, если открыты, должны быть заполнены
            if (this.deptSelect && !this.deptSelect.isValid()) enabled = false;
            if (this.reqSelect && !this.reqSelect.isValid()) enabled = false;
            if (this.groupSelect && !this.groupSelect.isValid()) enabled = false;
        } else if (this.mode === 'close') {
            const sol = $('solutionInput');
            const len = sol ? sol.value.trim().length : 0;
            enabled = len >= MIN_SOLUTION_LEN && !CAPS_REGEX.test(sol.value);
        }

        saveBtn.disabled = !enabled;
        saveBtn.style.opacity = enabled ? '1' : '0.5';
        saveBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    _setSaveBtnState(state) {
        const btn = document.getElementById('saveBtn');
        if (!btn) return;

        btn.classList.remove('btn-loading', 'btn-success', 'btn-error');

        if (state === 'loading') {
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.textContent = '';
        } else if (state === 'success') {
            btn.disabled = true;
            btn.classList.add('btn-success');
            btn.textContent = '';
        } else if (state === 'error') {
            btn.disabled = true;
            btn.classList.add('btn-error');
            btn.textContent = '';
        } else {
            btn.textContent = 'Сохранить';
            this._updateSaveButtonState();
        }
    }
    /**
     * Блокирует карточку после успешного сохранения.
     * Все клики запрещены, кроме кнопки «Вернуться в журнал».
     * Кнопка «Добавить комментарий» дополнительно блокируется через disabled.
     */
    _lockCard() {
        const grid = document.querySelector('.ticket-card-layout-grid');
        if (grid) grid.classList.add('card-locked');

        // Кнопка «Добавить комментарий»
        if (this.noteSubmitBtn) this.noteSubmitBtn.disabled = true;

        // Textarea composer — чтобы нельзя было печатать
        if (this.noteField && this.noteField.element) {
            const ta = this.noteField.element.querySelector('textarea');
            if (ta) ta.disabled = true;
        }
    }
    /**
     * Снимает блокировку с карточки.
     * Восстанавливает состояние кнопки «Добавить комментарий» по содержимому composer.
     */
    _unlockCard() {
        const grid = document.querySelector('.ticket-card-layout-grid');
        if (grid) grid.classList.remove('card-locked');

        if (this.noteField && this.noteField.element) {
            const ta = this.noteField.element.querySelector('textarea');
            if (ta) ta.disabled = false;
        }

        if (this.noteField && this.noteSubmitBtn) {
            const val = this.noteField.getValue();
            const valid = this.noteField.isValid();
            this.noteSubmitBtn.disabled = !valid || !val;
        }
    }
    async _onSave() {
        if (this.mode === 'edit' && Object.keys(this.pendingChanges).length === 0) return;

        const payload = {
            action: 'calledit',
            call_id: this.ticket.id,
            ...this.pendingChanges
        };

        if (this.mode === 'close') {
            const sol = document.getElementById('solutionInput');
            payload.solution = sol ? sol.value.trim() : '';
        }

        // Блокируем карточку сразу при отправке запроса.
        // Все действия, кроме «Вернуться в журнал», недоступны.
        this._lockCard();
        this._setSaveBtnState('loading');

        try {
            const response = await this.api.post(payload, '', 'details');

            if (response && response.status === 'ok') {
                this._setSaveBtnState('success');
                const msg = response.message || 'Изменения сохранены.';
                logHistoryAction(msg);
                notify.success(msg);

                // Сессия состава ответственных закрыта — счётчик сброшен
                this._staffChangedInSession = false;
                this._autoOpenPending = false;

                // Снапшот больше не нужен — данные на сервере, свежие прилетят в _refreshTicketAfterSave
                this._ticketSnapshot = null;

                this._refreshTicketAfterSave();
                // Если это закрытие заявки и стоит галочка — готовим контекст для новой
                const closeAndCreateCheck = document.getElementById('closeAndCreateCheck');
                const shouldCreateNew = this.mode === 'close'
                    && closeAndCreateCheck
                    && closeAndCreateCheck.checked;

                if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);

                if (shouldCreateNew) {
                    // ВАЖНО: Скрываем кнопку "Вернуться в журнал",
                    // чтобы пользователь не прервал процесс создания новой заявки
                    const backBtn = document.getElementById('backBtn');
                    if (backBtn) {
                        backBtn.style.display = 'none';
                    }
                    // Короткая пауза 3 секунды — пользователь видит зелёную галочку — потом в форму
                    const fromTicketId = this.ticket.id;
                    this.autoReturnTimer = setTimeout(() => {
                        appState.pendingCreateAddress = {
                            from_ticket_id: fromTicketId,
                            address:   this.ticket.address    || '',
                            city_id:   this.ticket.city_id    || null,
                            street_id: this.ticket.street_id  || null,
                            home_id:   this.ticket.home_id    || null,
                            object_id: this.ticket.object_id  || null
                        };
                        this.router.navigate('#/create');
                    }, 3000);
                } else {
                    // Стандартный автовозврат в журнал через 20 секунд
                    this.autoReturnTimer = setTimeout(() => {
                        if (window.location.hash.startsWith('#/ticket/')) {
                            this.router.navigate(this.ticket.type === 'close' ? '#/closed' : '#/');
                        }
                    }, AUTO_RETURN_MS);
                }
            } else {
                // Ошибка — красный крестик на 3 секунды, потом разблокировка и retry
                const msg = (response && response.message) || 'Не удалось сохранить изменения.';
                this._setSaveBtnState('error');
                logHistoryAction(msg);
                notify.error(msg);

                if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
                this.autoReturnTimer = setTimeout(() => {
                    this._unlockCard();
                    this._setSaveBtnState('idle');
                }, ERROR_UNLOCK_MS);
            }
        } catch (err) {
            console.error('[DetailsController] Save error:', err);
            this._setSaveBtnState('error');
            const msg = 'Сбой сети при сохранении: ' + (err.message || 'неизвестная ошибка');
            logHistoryAction(msg);
            notify.error('Не удалось сохранить. Проверьте соединение.');

            if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
            this.autoReturnTimer = setTimeout(() => {
                this._unlockCard();
                this._setSaveBtnState('idle');
            }, ERROR_UNLOCK_MS);
        }
    }

    // ======================================================================
    // КОММЕНТАРИИ
    // ======================================================================

    _renderNotesList(notesData) {
        const containerDOM = document.getElementById('notesContainerDOM');
        const countBadge = document.getElementById('notesCountBadge');
        if (!containerDOM) return;

        const notesList = Array.isArray(notesData)
            ? notesData
            : (notesData && typeof notesData === 'object' ? Object.values(notesData) : []);

        if (countBadge) countBadge.textContent = notesList.length;

        if (notesList.length === 0) {
            containerDOM.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); margin: auto 0; padding: 2rem;">
                    <div style="font-size: 13px; font-weight: 500;">Комментарии к заявке отсутствуют</div>
                </div>`;
            return;
        }

        containerDOM.innerHTML = '';
        notesList.forEach(note => {
            const noteItem = document.createElement('div');
            const isAccent = String(note.type) === '1';
            noteItem.style.cssText = `
                background: ${isAccent ? 'rgba(138, 43, 226, 0.05)' : 'var(--bg-primary)'};
                border: 1px solid ${isAccent ? 'var(--accent)' : 'var(--border-color)'};
                border-radius: 8px;
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;

            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-color); padding-bottom: 3px; margin-bottom: 2px;';

            const userSpan = document.createElement('span');
            userSpan.style.cssText = 'font-size: 12px; font-weight: 700;';
            userSpan.textContent = '👤 ' + (note.user || 'Сотрудник не указан');

            const dateSpan = document.createElement('span');
            dateSpan.style.cssText = 'font-size: 11px; color: var(--text-secondary); font-weight: 500;';
            dateSpan.textContent = '🕒 ' + (note.date || '—');

            header.appendChild(userSpan);
            header.appendChild(dateSpan);

            const body = document.createElement('div');
            body.style.cssText = 'font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word;';
            body.textContent = note.body || 'Пустая заметка.';

            noteItem.appendChild(header);
            noteItem.appendChild(body);
            containerDOM.appendChild(noteItem);
        });
    }
    /**
     * Форма добавления комментария к заявке.
     * Использует универсальный валидированный textarea.
     */
    _renderNoteComposer() {
        const container = document.getElementById('noteComposer');
        if (!container) return;

        // Сохраняем ссылку, чтобы использовать её в обработчике
        this.noteField = createValidatedTextarea({
            placeholder: 'Введите комментарий к заявке...',
            rows: 3,
            minLength: 1,
            voice: true,
            onChange: (value, isValid) => {
                if (this.noteSubmitBtn) {
                    this.noteSubmitBtn.disabled = !isValid || !value;
                    this.noteSubmitBtn.style.opacity = (!isValid || !value) ? '0.5' : '1';
                    this.noteSubmitBtn.style.cursor = (!isValid || !value) ? 'not-allowed' : 'pointer';
                }
            }
        });

        const submitBtn = document.createElement('button');
        submitBtn.textContent = 'Добавить комментарий';
        submitBtn.disabled = true;
        submitBtn.style.cssText = 'margin-top: 6px; padding: 8px 14px; border-radius: 6px; border: none; background: var(--accent); color: var(--mark-text); cursor: not-allowed; font-size: 13px; font-weight: 600; opacity: 0.5;';
        submitBtn.onclick = () => this._onAddNote();

        this.noteSubmitBtn = submitBtn;

        container.appendChild(this.noteField.element);
        container.appendChild(submitBtn);
    }

    /**
     * Отправка комментария через callnote.
     */
    async _onAddNote() {
        const text = this.noteField ? this.noteField.getValue() : '';
        if (!text) return;
        if (this.noteField && !this.noteField.isValid()) return;

        const payload = {
            action: 'callnote',
            call_id: this.ticket.id,
            note: text
        };

        // Блокируем кнопку на время отправки
        const btn = this.noteSubmitBtn;
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Отправка...';
            btn.style.opacity = '0.7';
        }

        try {
            const response = await this.api.post(payload, '', 'details');

            if (response && response.status === 'ok') {
                const msg = response.message || 'Комментарий добавлен.';
                logHistoryAction(msg);
                notify.success(msg);
                // Оптимистично добавляем заметку в UI, без перезагрузки карточки
                const now = new Date();
                const dateStr = now.toLocaleDateString('ru') + ' ' +
                    String(now.getHours()).padStart(2, '0') + ':' +
                    String(now.getMinutes()).padStart(2, '0');

                const note = {
                    id: 'local_' + Date.now(),
                    user: 'Вы',
                    body: text,
                    date: dateStr,
                    type: 0
                };

                // ticket.note — может быть массив, объект или отсутствовать
                if (Array.isArray(this.ticket.note)) {
                    this.ticket.note.push(note);
                } else if (this.ticket.note && typeof this.ticket.note === 'object') {
                    this.ticket.note[Object.keys(this.ticket.note).length + 1] = note;
                } else {
                    this.ticket.note = [note];
                }

                this._renderNotesList(this.ticket.note);
                this.noteField.reset();
                if (btn) {
                    btn.textContent = 'Добавить комментарий';
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                }
            } else {
                const msg = (response && response.message) || 'Не удалось добавить комментарий.';
                logHistoryAction(msg);
                notify.error(msg);
                if (btn) {
                    btn.textContent = 'Добавить комментарий';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                }
            }
        } catch (err) {
            console.error('[DetailsController] AddNote error:', err);
            logHistoryAction('Сбой сети при добавлении комментария.');
            notify.error('Не удалось добавить комментарий. Проверьте соединение.');
            if (btn) {
                btn.textContent = 'Добавить комментарий';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    }

    // ======================================================================
    // ВЫХОД СО СТРАНИЦЫ
    // ======================================================================

    unmount() {
        this._staffChangedInSession = false;
        this._autoOpenPending = false;
        // Останавливаем любую активную сессию распознавания речи
        destroyVoiceInput();
        // На всякий случай снимаем блокировку — перерисовка DOM её и так уберёт
        this._unlockCard();
        // Отменяем все активные запросы карточки
        this.api.abortTag('details');
        // Откатываем несохранённые правки, чтобы они не «протекли» в openTicketsArray
        if (this._ticketSnapshot && this.ticket) {
            this._getTicketSnapshotKeys().forEach(k => {
                this.ticket[k] = this._ticketSnapshot[k];
            });
            this._ticketSnapshot = null;
        }
                ['currentStaffSelect', 'repairPicker', 'deptSelect', 'reqSelect', 'groupSelect'].forEach(name => {
            const comp = this[name];
            if (comp && typeof comp.destroy === 'function') comp.destroy();
            this[name] = null;
        });
        if (this.autoReturnTimer) {
            clearTimeout(this.autoReturnTimer);
            this.autoReturnTimer = null;
        }
        if (this.noteField && typeof this.noteField.destroy === 'function') {
            this.noteField.destroy();
        }
        this.noteField = null;
        this.noteSubmitBtn = null;
        this.pendingChanges = {};
        this.mode = 'view';
        this.ticket = null;
        this.currentTicketId = null;
    }
}