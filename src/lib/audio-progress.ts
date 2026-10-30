const SAVE_INTERVAL_MS = 5_000;
const KEY_PREFIX = 'revoiced:audio:v1:';

interface SavedProgress {
  version: 1;
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: number;
}

export interface AudioProgressState {
  position: number;
  duration: number;
  completed: boolean;
  storageAvailable: boolean;
  restored: boolean;
}

function parseProgress(raw: string | null): SavedProgress | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      !Number.isFinite(value.position) || value.position < 0 ||
      !Number.isFinite(value.duration) || value.duration <= 0 ||
      value.position > value.duration ||
      typeof value.completed !== 'boolean' ||
      !Number.isFinite(value.updatedAt) || value.updatedAt < 0
    ) return null;
    return value;
  } catch {
    return null;
  }
}

/** A bookmark belongs to a book, independent of its URL or reading position. */
export function attachAudioProgress(
  audio: HTMLAudioElement,
  bookId: string,
  onChange: (state: AudioProgressState) => void,
) {
  const document = audio.ownerDocument;
  const window = document.defaultView!;
  const key = KEY_PREFIX + bookId;
  let storage: Storage | undefined;
  let storageAvailable = true;
  let initialized = false;
  let restoreTarget: number | null = null;
  let interacted = false;
  let completed = false;
  let restored = false;
  let lastSaved = '';
  let lastSaveTime = 0;
  const subscriptions: (() => void)[] = [];

  try {
    storage = window.localStorage;
  } catch {
    storageAvailable = false;
  }

  function notify() {
    onChange({
      position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      completed, storageAvailable, restored,
    });
  }

  function snapshot() {
    return {
      position: Math.min(Math.max(audio.currentTime, 0), audio.duration),
      duration: audio.duration,
      completed,
    };
  }

  function save(allowSeeking = false) {
    // Loading, restoring, or merely closing an idle tab must never replace a bookmark.
    if (!initialized || !interacted || restoreTarget !== null || (audio.seeking && !allowSeeking) ||
        !Number.isFinite(audio.currentTime) || !Number.isFinite(audio.duration) ||
        audio.duration <= 0) return;
    const progress = snapshot();
    const signature = JSON.stringify(progress);
    if (signature === lastSaved) return;
    lastSaveTime = Date.now();
    if (storage) {
      try {
        storage.setItem(key, JSON.stringify({ version: 1, ...progress, updatedAt: lastSaveTime }));
        storageAvailable = true;
        lastSaved = signature;
      } catch {
        storageAvailable = false;
      }
    }
    notify();
  }

  function restore() {
    if (initialized || audio.readyState < 1 || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    let saved: SavedProgress | null = null;
    try {
      saved = parseProgress(storage?.getItem(key) ?? null);
    } catch {
      storageAvailable = false;
    }
    if (saved) {
      // A shorter replacement recording must not receive an out-of-range seek.
      const position = Math.min(saved.position, audio.duration);
      completed = saved.completed;
      restored = position > 0 || completed;
      try {
        if (audio.currentTime !== position) {
          restoreTarget = position;
          audio.currentTime = position;
        }
      } catch {
        // Some media engines cannot seek at loadedmetadata; retry when data arrives.
        restoreTarget = null;
        return;
      }
      lastSaved = JSON.stringify(snapshot());
    }
    initialized = true;
    notify();
  }

  function listen(target: EventTarget, event: string, callback: () => void) {
    target.addEventListener(event, callback);
    subscriptions.push(() => target.removeEventListener(event, callback));
  }

  for (const event of ['loadedmetadata', 'durationchange', 'loadeddata', 'canplay']) {
    listen(audio, event, restore);
  }
  listen(audio, 'play', () => {
    restore();
    interacted = true;
    restored = false;
    if (completed) {
      completed = false;
      restoreTarget = null;
      audio.currentTime = 0;
    }
    notify();
  });
  listen(audio, 'timeupdate', () => {
    if (Date.now() - lastSaveTime >= SAVE_INTERVAL_MS) save();
  });
  listen(audio, 'seeking', () => {
    if (restoreTarget !== null) return;
    interacted = true;
    restored = false;
    if (audio.currentTime < audio.duration) completed = false;
  });
  listen(audio, 'seeked', () => {
    if (restoreTarget !== null && Math.abs(audio.currentTime - restoreTarget) < 0.1) {
      restoreTarget = null;
      notify();
      return;
    }
    restoreTarget = null;
    interacted = true;
    restored = false;
    if (audio.currentTime < audio.duration) completed = false;
    save();
  });
  listen(audio, 'pause', () => {
    // Browsers can dispatch pause before ended. Preserve the terminal state in both orders.
    if (audio.ended) completed = true;
    save(true);
    notify();
  });
  listen(audio, 'ended', () => {
    if (!audio.ended) return;
    interacted = true;
    restored = false;
    completed = true;
    save();
  });
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') save(true);
  });
  listen(window, 'pagehide', () => save(true));

  restore();
  if (!initialized) notify();

  return {
    restart() {
      if (!initialized) return;
      audio.pause();
      restoreTarget = null;
      interacted = true;
      completed = false;
      restored = false;
      audio.currentTime = 0;
      save(true);
      notify();
    },
    destroy() {
      save(true);
      subscriptions.forEach((unsubscribe) => unsubscribe());
    },
  };
}
