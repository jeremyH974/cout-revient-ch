/** État d'interface éphémère : toasts. */
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

function createToasts() {
  let items = $state<Toast[]>([]);
  let seq = 0;
  const dismiss = (id: number): void => {
    items = items.filter((t) => t.id !== id);
  };
  return {
    get items(): Toast[] {
      return items;
    },
    push(text: string, kind: Toast['kind'] = 'info', ms = 4500): void {
      const id = ++seq;
      items = [...items, { id, text, kind }];
      setTimeout(() => dismiss(id), ms);
    },
    dismiss,
  };
}

export const toasts = createToasts();

/** Mise à jour PWA : une nouvelle version attend d'être appliquée. */
function createUpdate() {
  let ready = $state(false);
  let apply: (() => void) | null = null;
  return {
    get ready(): boolean {
      return ready;
    },
    arm(fn: () => void): void {
      apply = fn;
      ready = true;
    },
    apply(): void {
      apply?.();
    },
  };
}

export const update = createUpdate();
