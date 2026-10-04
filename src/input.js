// Keyboard, mouse and touch. Three ways to look around:
//   'lock'  desktop with pointer lock (the normal case)
//   'drag'  desktop where pointer lock is refused: drag to look, click to act
//   'touch' phones and tablets: on-screen stick and buttons, drag to look

export class Input {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.keys = new Set();
    this.locked = false;
    this.mode = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window ? 'touch' : 'lock';
    this.stick = { x: 0, y: 0 };
    this.touchJump = false;
    this.touchSneak = false;
    this.drag = null;

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.sprintTap = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.sprintTap = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.h.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.h.onLockError());

    document.addEventListener('mousemove', (e) => {
      if (this.locked) this.h.onLook(e.movementX, e.movementY);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.locked) {
        e.preventDefault();
        this.h.onAction(e.button, true);
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (this.locked) this.h.onAction(e.button, false);
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.locked || this.mode === 'drag') {
        e.preventDefault();
        this.h.onWheel(Math.sign(e.deltaY));
      }
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Drag-to-look for touch and for desktops without pointer lock.
    canvas.addEventListener('pointerdown', (e) => this.onDragStart(e));
    canvas.addEventListener('pointermove', (e) => this.onDragMove(e));
    canvas.addEventListener('pointerup', (e) => this.onDragEnd(e));
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
  }

  onKeyDown(e) {
    if (e.target instanceof HTMLInputElement) return;
    const handled = this.h.onKey(e.code, e);
    if (handled || ['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    // Double-tapping forward sprints until forward is let go, as in Minecraft.
    if ((e.code === 'KeyW' || e.code === 'ArrowUp') && !e.repeat) {
      const now = performance.now();
      if (now - (this.lastForward ?? -1e9) < 300) this.sprintTap = true;
      this.lastForward = now;
    }
    this.keys.add(e.code);
  }

  onDragStart(e) {
    if (this.locked || this.mode === 'lock') return;
    if (e.pointerType === 'mouse' && this.mode !== 'drag') return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, button: e.button, at: performance.now() };
    this.canvas.setPointerCapture(e.pointerId);
  }

  onDragMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    const gain = e.pointerType === 'touch' ? 2.2 : 1.6;
    this.h.onLook(dx * gain, dy * gain);
  }

  onDragEnd(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    // In drag mode a click without movement breaks (left) or places (right).
    if (this.mode === 'drag' && d.moved < 6 && performance.now() - d.at < 400) {
      this.h.onAction(d.button, true);
      this.h.onAction(d.button, false);
    }
  }

  requestLock() {
    if (this.mode !== 'lock') return;
    try {
      const result = this.canvas.requestPointerLock();
      // Newer browsers return a promise; the pointerlockerror event covers the rest.
      if (result && result.catch) result.catch(() => {});
    } catch {
      this.h.onLockError();
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  useDragMode() {
    this.mode = 'drag';
  }

  // Movement intent from keys and the touch stick.
  movement() {
    const k = this.keys;
    let forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (this.stick.x || this.stick.y) {
      forward = -this.stick.y;
      strafe = this.stick.x;
    }
    return {
      forward,
      strafe,
      jump: k.has('Space') || this.touchJump,
      sneak: k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSneak,
      sprint: k.has('ControlLeft') || k.has('ControlRight') || this.sprintTap || (this.mode === 'touch' && -this.stick.y > 0.92),
    };
  }

  // Wire the on-screen joystick and buttons (touch mode only).
  bindTouchControls(root, actions) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#stick-knob');
    let stickId = null;
    let centre = null;
    const setStick = (x, y) => {
      const r = stick.clientWidth / 2;
      let dx = (x - centre[0]) / r;
      let dy = (y - centre[1]) / r;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.stick = { x: Math.abs(dx) < 0.12 ? 0 : dx, y: Math.abs(dy) < 0.12 ? 0 : dy };
      knob.style.transform = `translate(${dx * r * 0.6}px, ${dy * r * 0.6}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      const rect = stick.getBoundingClientRect();
      centre = [rect.left + rect.width / 2, rect.top + rect.height / 2];
      stick.setPointerCapture(e.pointerId);
      setStick(e.clientX, e.clientY);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) setStick(e.clientX, e.clientY); });
    const release = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    const hold = (id, onDown, onUp) => {
      const el = root.querySelector(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('down'); onDown(); });
      const up = () => { el.classList.remove('down'); onUp?.(); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    hold('#t-jump', () => { this.touchJump = true; actions.jump?.(); }, () => { this.touchJump = false; });
    hold('#t-sneak', () => { this.touchSneak = true; }, () => { this.touchSneak = false; });
    hold('#t-break', () => this.h.onAction(0, true), () => this.h.onAction(0, false));
    hold('#t-place', () => this.h.onAction(2, true), () => this.h.onAction(2, false));
    hold('#t-fly', () => actions.fly());
    hold('#t-blocks', () => actions.inventory());
    hold('#t-pause', () => actions.pause());
    hold('#t-drop', () => actions.drop());
    hold('#t-chat', () => actions.chat());
  }
}
