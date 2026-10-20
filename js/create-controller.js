import { staffStore } from './staff-store.js';
import { createDictSelect } from './components/dict-select.js';
import { createRepairTimePicker } from './components/repair-time-picker.js';
import { createStaffSelect } from './components/staff-select.js';
import { initVoiceTextarea, destroyVoiceInput } from './components/voiceInput.js';
import { notify } from './components/notify.js';
import { logHistoryAction } from './history-logger.js';
import { VALIDATION, UI } from './config.js';
import { appState } from './app-state.js';
import { createAddressPicker } from './components/address-picker.js';
import { offlineDB } from './offline-db.js';
import { OFFLINE } from './config.js';
import { authStore } from './auth-store.js';
export class CreateController {
    constructor(apiInstance, routerInstance) {
        this.api = apiInstance;
        this.router = routerInstance;
        this.autoReturnTimer = null;
        this.isLocked = false;
        this.staffSelect = null;
        this.repairPicker = null;
        this.deptSelect = null;
        this.reqSelect = null;
        this.groupSelect = null;
        this.prefilledAddress = null;
        this.addressPicker = null;
    }

    mount(globalTicketsArrayRef) {
        // Проверяем, пришли ли мы из карточки после закрытия с галочкой «создать новую»
        this.prefilledAddress = null;
        if (appState.pendingCreateAddress) {
            const ctx = appState.pendingCreateAddress;
            appState.pendingCreateAddress = null;   // одноразовый
            this.prefilledAddress = ctx;

            // Заполняем поле адреса
            const addrInput = document.getElementById('formAddress');
            if (addrInput) {
                addrInput.value = ctx.address || '';
                addrInput.readOnly = true;
                addrInput.classList.add('address-locked');
                addrInput.title = 'Адрес нельзя изменить: заявка создаётся для того же объекта';
            }

            // Подпись под полем
            const addrHint = document.getElementById('formAddressHint');
            if (addrHint && ctx.from_ticket_id) {
                addrHint.textContent = '📍 Адрес из заявки №' + ctx.from_ticket_id + ' — объект наследуется автоматически';
                addrHint.style.display = 'block';
            }

            // Обновляем заголовок страницы — чтобы было понятно, что это не «обычное» создание
            const h1 = document.querySelector('.create-form-wrapper h1')
                || document.querySelector('h1');
            if (h1 && ctx.from_ticket_id) {
                h1.textContent = 'Новая заявка для объекта из заявки №' + ctx.from_ticket_id;
            }
        }
        // === Инициализация AddressPicker ===
        const addressSlot = document.getElementById('formAddressSlot');
        if (addressSlot && !this.addressPicker) {
            this.addressPicker = createAddressPicker({
                onChange: (data) => {
                    this._updateSaveBtnState();
                }
            });
            addressSlot.innerHTML = '';
            addressSlot.appendChild(this.addressPicker.element);
        }

        // Компонент выбора механика с поиском
        const staffSlot = document.getElementById('formStaffSlot');
        if (staffSlot && !this.staffSelect) {
            this.staffSelect = createStaffSelect({
                list: staffStore.list,
                placeholder: 'Начните вводить имя...'
            });
            staffSlot.innerHTML = '';
            staffSlot.appendChild(this.staffSelect.element);
        }

        // Компонент «Предполагаемое окончание ремонта» — создаём один раз за mount
        const repairSlot = document.getElementById('repairTimeSlot');
        if (repairSlot && !this.repairPicker) {
            this.repairPicker = createRepairTimePicker({
                initialValue: null,
                onChange: () => { /* зарезервировано под валидацию */ }
            });
            repairSlot.innerHTML = '';
            repairSlot.appendChild(this.repairPicker.element);
        }

        // Справочники отдел / запрос / группа
        const slots = [
            { id: 'createDeptSlot',  key: 'department', ref: 'deptSelect',  placeholder: '— выберите отдел —' },
            { id: 'createReqSlot',   key: 'request',    ref: 'reqSelect',   placeholder: '— выберите тип —' },
            { id: 'createGroupSlot', key: 'group',      ref: 'groupSelect', placeholder: '— выберите группу —' }
        ];

        slots.forEach(s => {
            const container = document.getElementById(s.id);
            if (container && !this[s.ref]) {
                const comp = createDictSelect({
                    key: s.key,
                    placeholder: s.placeholder,
                    required: true,
                    onChange: () => this._updateSaveBtnState()
                });
                container.innerHTML = '';
                container.appendChild(comp.element);
                this[s.ref] = comp;
            }
        });

        this._updateSaveBtnState();
        // Голосовой ввод для textarea описания
        const formDetails = document.getElementById('formDetails');
        const formDetailsRow = document.getElementById('formDetailsRow');
        if (formDetails) {
            initVoiceTextarea(formDetails, formDetailsRow ? { container: formDetailsRow } : {});
        }
        // Валидация капса на описании
        if (formDetails) {
            const capsWarn = document.getElementById('capsWarnFormDetails');
            formDetails.oninput = () => {
                const hasCaps = VALIDATION.CAPS_REGEX.test(formDetails.value);
                if (capsWarn) capsWarn.style.display = hasCaps ? 'block' : 'none';
                this._updateSaveBtnState();
            };
        }
        // Кнопка «Отмена»
        const cancelBtn = document.getElementById('cancelFormBtn');
        if (cancelBtn) {
            cancelBtn.onclick = () => this.router.navigate('#/');
        }

        // Кнопка «Сохранить заявку»
        const saveBtn = document.getElementById('saveTicketBtn');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                // 1. Получаем данные из нового компонента адреса
                const addressData = this.addressPicker ? this.addressPicker.getValue() : null;
                const details = document.getElementById('formDetails').value.trim();
                const staffId = this.staffSelect ? this.staffSelect.getValue() : null;

                // 2. Проверяем обязательные поля
                if (!addressData || !details) {
                    const msg = 'Заполните обязательные поля: выберите адрес и введите описание проблемы.';
                    notify.error(msg);
                    logHistoryAction(msg);
                    return;
                }

                // 3. Проверяем дату ремонта и справочники
                if (this.repairPicker && !this.repairPicker.isValid()) {
                    const msg = 'Дата ремонта указана некорректно: должна быть не менее чем через 30 минут от текущего момента.';
                    notify.error(msg);
                    logHistoryAction(msg);
                    return;
                }

                if (!this.deptSelect?.isValid() || !this.reqSelect?.isValid() || !this.groupSelect?.isValid()) {
                    const msg = 'Пожалуйста, выберите отдел, тип запроса и группу.';
                    notify.error(msg);
                    logHistoryAction(msg);
                    return;
                }

                const staffObj = staffStore.getById(staffId);

                // 4. Формируем объект заявки с ID из addressData
                const newTicket = {
                    // Вместо старого address используем addressData.address
                    address: addressData.address,
                    city_id: addressData.city_id,
                    street_id: addressData.street_id,
                    home_id: addressData.home_id,
                    object_id: addressData.object_id,

                    details: details,
                    department_id: this.deptSelect?.getValue() || null,
                    request_id: this.reqSelect?.getValue() || null,
                    group_id: this.groupSelect?.getValue() || null,
                    staff_id: staffId || null,
                    staff: staffObj ? staffObj.name : 'Не назначен',
                    staff_date: new Date().toLocaleDateString() + ' - создана диспетчером',
                    department: '1.Электромеханики',
                    date: new Date().toLocaleString('ru'),
                    repair_time: this.repairPicker ? this.repairPicker.getValue() : null,
                    close_date: '—',
                    solution: '',
                    full_history: 'Дата изменений: ' + new Date().toLocaleString() + ' - создана диспетчером локально.'
                };

                // Блокируем форму
                this._lockForm();
                this._setSaveBtnState('loading');

                // Дальше идет проверка navigator.onLine и try/catch, которые мы добавляли в прошлом шаге...
                // ПРОВЕРКА: Если браузер знает, что сети нет
                if (!navigator.onLine) {
                    await this._saveOffline(newTicket, globalTicketsArrayRef);
                    return;
                }

                try {
                    const response = await this.api.post(newTicket, 'Запись инцидента...');

                    // Если сервер ответил ошибкой СЕТИ (fetch упал)
                    if (response && response.code === 'network_error') {
                        await this._saveOffline(newTicket, globalTicketsArrayRef);
                        return;
                    }

                    // Успешное сохранение онлайн
                    if (response && response.status === 'ok') {
                        this._setSaveBtnState('success');
                        const msg = response.message || 'Заявка зарегистрирована.';
                        logHistoryAction(msg);
                        notify.success(msg);

                        // Добавляем в массив (временно с локальным ID)
                        globalTicketsArrayRef.unshift(newTicket);

                        if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
                        this.autoReturnTimer = setTimeout(() => {
                            this.router.navigate('#/');
                        }, UI.AUTO_RETURN_MS);
                    } else {
                        // Логическая ошибка сервера (не сеть)
                        const msg = (response && response.message) || 'Не удалось создать заявку.';
                        this._setSaveBtnState('error');
                        logHistoryAction(msg);
                        notify.error(msg);

                        if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
                        this.autoReturnTimer = setTimeout(() => {
                            this._unlockForm();
                            this._setSaveBtnState('idle');
                        }, UI.ERROR_UNLOCK_MS);
                    }
                } catch (err) {
                    // Любая другая ошибка (таймаут и т.д.)
                    console.error('[CreateController] Save error:', err);
                    await this._saveOffline(newTicket, globalTicketsArrayRef);
                }
            };
        }
    }
    /**
     * Блокирует форму создания. Все клики запрещены,
     * кроме кнопки «Отмена» (вернуться в журнал).
     */
    _lockForm() {
        this.isLocked = true;
        const wrapper = document.querySelector('.create-form-wrapper');
        if (wrapper) wrapper.classList.add('create-form-locked');
    }

    /**
     * Снимает блокировку формы.
     */
    _unlockForm() {
        this.isLocked = false;
        const wrapper = document.querySelector('.create-form-wrapper');
        if (wrapper) wrapper.classList.remove('create-form-locked');
    }

    /**
     * Управляет состоянием кнопки «Сохранить заявку»:
     * idle (по умолчанию) | loading | success | error.
     */
    _setSaveBtnState(state) {
        const btn = document.getElementById('saveTicketBtn');
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
            btn.textContent = 'Сохранить заявку';
            this._updateSaveBtnState();
        }
    }
    /**
     * Обновляет состояние кнопки «Сохранить заявку».
     * Активна только когда все три обязательных селекта заполнены.
     */
    _updateSaveBtnState() {
        const btn = document.getElementById('saveTicketBtn');
        if (!btn || this.isLocked) return;

        const formDetails = document.getElementById('formDetails');
        const hasCaps = formDetails && VALIDATION.CAPS_REGEX.test(formDetails.value);

        const allFilled =
            this.deptSelect?.isValid() &&
            this.reqSelect?.isValid() &&
            this.groupSelect?.isValid() &&
            !hasCaps;

        btn.disabled = !allFilled;
        btn.style.opacity = allFilled ? '1' : '0.5';
        btn.style.cursor = allFilled ? 'pointer' : 'not-allowed';
    }
    async _saveOffline(ticketPayload, globalTicketsArrayRef) {
        try {
            const count = await offlineDB.getOutboxCount();
            if (count >= OFFLINE.MAX_OFFLINE_TICKETS) {
                this._setSaveBtnState('error');
                const msg = `Достигнут лимит офлайн-заявок (${OFFLINE.MAX_OFFLINE_TICKETS}). Дождитесь синхронизации.`;
                notify.error(msg);
                logHistoryAction(msg);
                setTimeout(() => { this._unlockForm(); this._setSaveBtnState('idle'); }, UI.ERROR_UNLOCK_MS);
                return;
            }

            const user = authStore.getUser();
            const uuid = 'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

            const offlineTicket = {
                uuid: uuid,
                original_author_id: user ? user.id : 0,
                original_author_name: user ? user.name : 'Неизвестный',
                payload: ticketPayload,
                created_at: Date.now()
            };

            await offlineDB.addToOutbox(offlineTicket);

            this._setSaveBtnState('success');
            const msg = 'Заявка сохранена локально (нет сети). Синхронизация при восстановлении связи.';
            notify.info(msg);
            logHistoryAction(msg);

            // Добавляем локальную заявку в массив (чтобы она сразу появилась в журнале)
            globalTicketsArrayRef.unshift({
                ...ticketPayload,
                id: uuid,
                type: 'open',
                date: new Date().toLocaleString('ru'),
                isOffline: true
            });

            if (this.autoReturnTimer) clearTimeout(this.autoReturnTimer);
            this.autoReturnTimer = setTimeout(() => {
                this.router.navigate('#/');
            }, UI.AUTO_RETURN_MS);

        } catch (e) {
            console.error('[CreateController] Offline save error:', e);
            this._setSaveBtnState('error');
            notify.error('Сбой локальной базы данных.');
            setTimeout(() => { this._unlockForm(); this._setSaveBtnState('idle'); }, UI.ERROR_UNLOCK_MS);
        }
    }

    /**
     * Вызывается роутером при уходе с #/create.
     * Уничтожает все компоненты и освобождает ссылки.
     */
    unmount() {
        destroyVoiceInput();
        this._unlockForm();
        this.prefilledAddress = null;
        // Отменяем активный запрос сохранения заявки
        this.api.abortTag('create');
        if (this.autoReturnTimer) {
            clearTimeout(this.autoReturnTimer);
            this.autoReturnTimer = null;
        }
        if (this.addressPicker && typeof this.addressPicker.destroy === 'function') {
            this.addressPicker.destroy();
        }
        ['staffSelect', 'repairPicker', 'deptSelect', 'reqSelect', 'groupSelect'].forEach(name => {
            const comp = this[name];
            if (comp && typeof comp.destroy === 'function') comp.destroy();
            this[name] = null;
        });
    }
}
