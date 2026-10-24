/**
 * Кастомный confirm/alert на базе .modal-overlay.
 * Нативные confirm/alert используются только для деструктивных операций
 * (logout, clearCache, acceptAll) — см. main.js / list-controller.js.
 *
 * Создаёт в DOM один переиспользуемый модал #uiModal (по требованию).
 */

function ensureModal() {
  let modal = document.getElementById("uiModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "uiModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
        <div class="modal-content">
            <h3 id="uiModalTitle"></h3>
            <p id="uiModalMessage"></p>
            <div class="modal-actions" id="uiModalActions"></div>
        </div>
    `;
  document.body.appendChild(modal);
  return modal;
}

function show({ title = "", message = "", buttons = [] }) {
  const modal = ensureModal();
  const titleEl = modal.querySelector("#uiModalTitle");
  const msgEl = modal.querySelector("#uiModalMessage");
  const actionsEl = modal.querySelector("#uiModalActions");

  titleEl.textContent = title;
  titleEl.style.display = title ? "" : "none";
  msgEl.textContent = message;
  msgEl.style.display = message ? "" : "none";

  actionsEl.innerHTML = "";

  return new Promise((resolve) => {
    buttons.forEach((btn, idx) => {
      const b = document.createElement("button");
      b.className = btn.primary ? "btn-confirm" : "btn-cancel";
      b.textContent = btn.label || "OK";
      b.onclick = () => {
        modal.classList.remove("active");
        resolve(btn.value !== undefined ? btn.value : idx);
      };
      actionsEl.appendChild(b);
    });
    modal.classList.add("active");
  });
}

export const ui = {
  async confirm(message, title = "Подтверждение") {
    const result = await show({
      title,
      message,
      buttons: [
        { label: "Отмена", value: false },
        { label: "OK", value: true, primary: true },
      ],
    });
    return result === true;
  },

  async alert(message, title = "Сообщение") {
    await show({
      title,
      message,
      buttons: [{ label: "OK", value: true, primary: true }],
    });
  },
};
