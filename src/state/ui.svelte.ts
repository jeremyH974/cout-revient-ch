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
