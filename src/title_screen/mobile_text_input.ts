/**
 * A real (but invisible) <input> element that backs canvas-drawn text fields.
 * Canvas rectangles cannot receive keyboard focus, so mobile browsers never
 * open the on-screen keyboard for them. Focusing this element from inside the
 * tap/click handler summons the keyboard; typed text is mirrored back into
 * canvas state via onInput. Desktop typing flows through the same element —
 * both title-screen document keydown listeners already ignore events while a
 * real input has focus.
 */
export interface HiddenTextInputTarget {
    value: string;
    password?: boolean;
    maxLength?: number;
    onInput: (value: string) => void;
    onEnter?: () => void;
    onTab?: () => void;
    onBlur?: () => void;
}

export class HiddenTextInput {
    private input: HTMLInputElement | null = null;
    private target: HiddenTextInputTarget | null = null;

    private ensureElement(): HTMLInputElement {
        if (this.input) return this.input;
        const input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('enterkeyhint', 'go');
        // Invisible but focusable: display:none or visibility:hidden would
        // block focus (and the keyboard) entirely. font-size must stay >= 16px
        // or iOS zooms the page when the field gains focus.
        input.style.cssText =
            'position:fixed;top:35%;left:50%;width:2px;height:2px;opacity:0;' +
            'font-size:16px;border:none;padding:0;background:transparent;' +
            'pointer-events:none;z-index:-1;';

        input.addEventListener('input', () => {
            const t = this.target;
            if (!t) return;
            let v = input.value;
            if (t.maxLength && v.length > t.maxLength) {
                v = v.slice(0, t.maxLength);
                input.value = v;
            }
            t.onInput(v);
        });

        input.addEventListener('keydown', (e) => {
            const t = this.target;
            if (!t) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                t.onEnter?.();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                t.onTab?.();
            } else if (e.key === 'Escape') {
                input.blur();
            }
        });

        input.addEventListener('blur', () => {
            const t = this.target;
            this.target = null;
            t?.onBlur?.();
        });

        document.body.appendChild(input);
        this.input = input;
        return input;
    }

    /**
     * Must be called synchronously from a user-gesture handler (tap/click),
     * or mobile browsers refuse to open the keyboard.
     */
    public focus(target: HiddenTextInputTarget): void {
        const input = this.ensureElement();
        input.type = target.password ? 'password' : 'text';
        this.target = target;
        input.value = target.value;
        input.focus();
    }

    public blur(): void {
        // Null the target first so the blur event skips the onBlur callback —
        // callers of blur() have already updated their own focus state.
        this.target = null;
        if (this.input && document.activeElement === this.input) this.input.blur();
    }

    public isActive(): boolean {
        return this.input !== null && document.activeElement === this.input;
    }
}
