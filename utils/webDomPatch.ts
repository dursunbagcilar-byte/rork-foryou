const isWeb =
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  typeof Node !== 'undefined';

if (isWeb) {
  const patchKey = '__rork_dom_patch__';
  const g = globalThis as unknown as Record<string, unknown>;

  if (!g[patchKey]) {
    g[patchKey] = true;

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const _removeChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(child: T): T {
      if (child.parentNode !== this) {
        return child;
      }
      return _removeChild.call(this, child) as T;
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const _insertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(
      newNode: T,
      ref: Node | null,
    ): T {
      if (ref && ref.parentNode !== this) {
        return _insertBefore.call(this, newNode, null) as T;
      }
      return _insertBefore.call(this, newNode, ref) as T;
    };

    window.addEventListener('error', (event: ErrorEvent) => {
      if (
        event.message &&
        (event.message.includes('removeChild') ||
          event.message.includes('insertBefore')) &&
        event.message.includes('not a child')
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
        return true;
      }
      return false;
    }, true);
  }
}

export {};
