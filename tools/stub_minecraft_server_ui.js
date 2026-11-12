// Заглушка @minecraft/server-ui для дымовых тестов
class ActionFormData {
    constructor() { this.buttons = []; globalThis.__lastActionForm = this; }
    title(t) { this.titleText = t; return this; }
    body(b) { this.bodyText = b; return this; }
    button(label, icon) { this.buttons.push(label); return this; }
    show() {
        if ((globalThis.__busyActionForms || 0) > 0) {
            globalThis.__busyActionForms--;
            return Promise.resolve({ canceled: true, cancelationReason: "UserBusy" });
        }
        const sel = typeof globalThis.__formSelection === "number" ? globalThis.__formSelection : 0;
        return Promise.resolve({ canceled: false, selection: sel });
    }
}
class ModalFormData {
    constructor() { this.fields = []; globalThis.__lastModalForm = this; }
    title(t) { this.titleText = t; return this; }
    textField(label, placeholder, def) { this.fields.push({ label, placeholder, def }); return this; }
    dropdown(label, options, def) { this.fields.push({ label, options, def }); return this; }
    slider(label, min, max, step, def) { this.fields.push({ label, min, max, step, def }); return this; }
    toggle(label, def) { this.fields.push({ label, def }); return this; }
    show() {
        if ((globalThis.__busyModalForms || 0) > 0) {
            globalThis.__busyModalForms--;
            return Promise.resolve({ canceled: true, cancelationReason: "UserBusy" });
        }
        const vals = globalThis.__formValues || ["", "", ""];
        return Promise.resolve({ canceled: false, formValues: vals });
    }
}
export { ActionFormData, ModalFormData };
