const canPatchDom =
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  typeof Node !== 'undefined';

if (canPatchDom) {
  try {
    const patchKey = '__rork_dom_patch__';
    const globalStore = globalThis as Record<string, unknown>;

    if (!globalStore[patchKey]) {
      globalStore[patchKey] = true;

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalRemoveChild = Node.prototype.removeChild;
      Node.prototype.removeChild = function <T extends Node>(child: T): T {
        if (!child || child.parentNode !== this) {
          return child;
        }
        return originalRemoveChild.call(this, child) as T;
      };

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalInsertBefore = Node.prototype.insertBefore;
      Node.prototype.insertBefore = function <T extends Node>(
        newNode: T,
        referenceNode: Node | null,
      ): T {
        if (!referenceNode || referenceNode.parentNode !== this) {
          return originalInsertBefore.call(this, newNode, null) as T;
        }
        return originalInsertBefore.call(this, newNode, referenceNode) as T;
      };

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalReplaceChild = Node.prototype.replaceChild;
      Node.prototype.replaceChild = function <T extends Node>(
        newChild: Node,
        oldChild: T,
      ): T {
        if (!oldChild || oldChild.parentNode !== this || newChild === oldChild) {
          return oldChild;
        }
        return originalReplaceChild.call(this, newChild, oldChild) as T;
      };

      if (typeof window.addEventListener === 'function') {
        window.addEventListener(
          'error',
          (event: ErrorEvent) => {
            const message = event.message ?? '';
            const isPatchedOperation =
              message.includes('removeChild') ||
              message.includes('insertBefore') ||
              message.includes('replaceChild');
            const isKnownDomMismatch =
              message.includes('not a child') ||
              message.includes('to be removed is not a child of this node') ||
              message.includes('The child can not be found in the parent');

            if (isPatchedOperation && isKnownDomMismatch) {
              event.stopImmediatePropagation();
              event.preventDefault();
              return true;
            }

            return false;
          },
          true,
        );
      }
    }
  } catch (error) {
    console.log('[webDomPatch] Failed to initialize DOM patch:', error);
  }
}

export {};
