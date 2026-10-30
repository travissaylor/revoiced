import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAudioProgress } from '../src/lib/audio-progress.ts';

const key = (id = 'author/book') => `revoiced:audio:v1:${id}`;
const record = (position, completed = false, duration = 100) => JSON.stringify({
  version: 1, position, duration, completed, updatedAt: 1,
});
class MemoryStorage {
  values = new Map();
  writes = 0;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes++; this.values.set(key, value); }
}
class Media extends EventTarget {
  currentTime = 0;
  duration = 100;
  readyState = 1;
  seeking = false;
  paused = true;
  ended = false;
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  play() { this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); }
}
function setup({ storage = new MemoryStorage(), id = 'author/book', ready = true, duration = 100, blockedGetter = false } = {}) {
  const window = new EventTarget();
  Object.defineProperty(window, 'localStorage', { get() {
    if (blockedGetter) throw new Error('blocked');
    return storage;
  }});
  const document = new EventTarget();
  document.defaultView = window;
  document.visibilityState = 'visible';
  const audio = new Media();
  audio.ownerDocument = document;
  audio.readyState = ready ? 1 : 0;
  audio.duration = ready ? duration : NaN;
  const states = [];
  const controller = attachAudioProgress(audio, id, (state) => states.push(state));
  return { audio, window, document, storage, states, controller,
    saved: () => JSON.parse(storage.getItem(key(id))),
    metadata() { audio.readyState = 1; audio.duration = duration; emit(audio, 'loadedmetadata'); },
  };
}
function emit(target, name) { target.dispatchEvent(new Event(name)); }
function finishSeek(audio) { audio.seeking = true; emit(audio, 'seeking'); audio.seeking = false; emit(audio, 'seeked'); }
function seek(audio, time) { audio.seeking = true; audio.currentTime = time; emit(audio, 'seeking'); emit(audio, 'timeupdate'); audio.seeking = false; emit(audio, 'seeked'); }

for (const ready of [true, false]) {
  test(`restores ${ready ? 'already available' : 'delayed'} metadata without autoplay or zero overwrite`, () => {
    const storage = new MemoryStorage(); storage.setItem(key(), record(42));
    const writes = storage.writes;
    const h = setup({ storage, ready });
    emit(h.audio, 'timeupdate'); emit(h.window, 'pagehide');
    if (!ready) { assert.equal(h.audio.currentTime, 0); h.metadata(); }
    assert.equal(h.audio.currentTime, 42);
    assert.equal(h.audio.paused, true);
    finishSeek(h.audio);
    h.audio.pause(); emit(h.window, 'pagehide');
    assert.equal(storage.writes, writes);
    assert.equal(h.states.at(-1).restored, true);
  });
}

test('book bookmarks are independent and restore on a fresh page', () => {
  const storage = new MemoryStorage();
  const a = setup({ storage, id: 'a/one' }); seek(a.audio, 25);
  const b = setup({ storage, id: 'a/two' }); seek(b.audio, 60);
  assert.equal(setup({ storage, id: 'a/one' }).audio.currentTime, 25);
  assert.equal(setup({ storage, id: 'a/two' }).audio.currentTime, 60);
});

test('timeupdate saves at bounded intervals and pause flushes immediately', () => {
  const originalNow = Date.now;
  let now = 10000; Date.now = () => now;
  try {
    const h = setup(); h.audio.play(); h.audio.currentTime = 5; emit(h.audio, 'timeupdate');
    assert.equal(h.saved().position, 5);
    h.audio.currentTime = 7; now += 1000; emit(h.audio, 'timeupdate');
    assert.equal(h.storage.writes, 1);
    now += 5000; emit(h.audio, 'timeupdate'); assert.equal(h.saved().position, 7);
    h.audio.currentTime = 8; h.audio.pause(); assert.equal(h.saved().position, 8);
  } finally { Date.now = originalNow; }
});

for (const exit of ['seek', 'hidden', 'pagehide']) {
  test(`${exit} flushes actual playback and preserves a seek on immediate exit`, () => {
    const h = setup(); h.audio.play();
    if (exit === 'seek') seek(h.audio, 34);
    else {
      h.audio.currentTime = 34;
      if (exit === 'hidden') { h.document.visibilityState = 'hidden'; emit(h.document, 'visibilitychange'); }
      else emit(h.window, 'pagehide');
    }
    assert.equal(h.saved().position, 34);
    h.audio.seeking = true; h.audio.currentTime = 50; h.audio.pause(); emit(h.window, 'pagehide');
    assert.equal(h.saved().position, 50);
    h.audio.seeking = false; emit(h.audio, 'seeked'); assert.equal(h.saved().position, 50);
  });
}

for (const pauseFirst of [true, false]) {
  test(`completion survives revisit and replay, pause ${pauseFirst ? 'before' : 'after'} ended`, () => {
    const h = setup(); h.audio.play(); h.audio.currentTime = 100; h.audio.ended = true;
    if (pauseFirst) h.audio.pause();
    emit(h.audio, 'ended');
    if (!pauseFirst) h.audio.pause();
    emit(h.window, 'pagehide'); assert.equal(h.saved().completed, true);
    const revisit = setup({ storage: h.storage }); finishSeek(revisit.audio);
    assert.equal(revisit.states.at(-1).completed, true);
    assert.equal(revisit.audio.paused, true);
    revisit.audio.play(); finishSeek(revisit.audio);
    assert.equal(revisit.audio.currentTime, 0);
    assert.equal(revisit.saved().completed, false);
  });
}

test('explicit restart rewinds, pauses, and persists a fresh start', () => {
  const h = setup(); h.audio.play(); seek(h.audio, 70);
  h.controller.restart(); finishSeek(h.audio);
  assert.equal(h.audio.currentTime, 0); assert.equal(h.audio.paused, true);
  assert.equal(h.saved().position, 0); assert.equal(h.saved().completed, false);
});

test('a paused user seek is saved on exit even before seeked arrives', () => {
  const h = setup();
  h.audio.seeking = true; h.audio.currentTime = 39; emit(h.audio, 'seeking');
  emit(h.window, 'pagehide');
  assert.equal(h.saved().position, 39);
  assert.equal(h.saved().completed, false);
});

test('restart saves zero immediately while the media engine is still seeking', () => {
  const h = setup(); seek(h.audio, 70);
  let position = 70;
  Object.defineProperty(h.audio, 'currentTime', {
    get: () => position,
    set: (value) => { position = value; h.audio.seeking = true; },
  });
  h.controller.restart();
  assert.equal(h.audio.seeking, true);
  assert.equal(h.saved().position, 0);
});

test('seeking back from a finished book clears completion before exit', () => {
  const storage = new MemoryStorage(); storage.setItem(key(), record(100, true));
  const h = setup({ storage }); finishSeek(h.audio);
  h.audio.currentTime = 40; h.audio.seeking = true; emit(h.audio, 'seeking');
  h.document.visibilityState = 'hidden'; emit(h.document, 'visibilitychange');
  assert.equal(h.saved().position, 40);
  assert.equal(h.saved().completed, false);
});

test('near the end is not completion and hidden playback keeps saving', () => {
  const originalNow = Date.now;
  let now = 10000; Date.now = () => now;
  try {
    const h = setup(); h.audio.play(); h.audio.currentTime = 95;
    h.document.visibilityState = 'hidden'; emit(h.document, 'visibilitychange');
    now += 5000; h.audio.currentTime = 99.5; emit(h.audio, 'timeupdate');
    assert.equal(h.saved().position, 99.5);
    assert.equal(h.saved().completed, false);
  } finally { Date.now = originalNow; }
});

test('shortened replacement recording clamps restoration safely', () => {
  const storage = new MemoryStorage(); storage.setItem(key(), record(90));
  const h = setup({ storage, duration: 50 });
  assert.equal(h.audio.currentTime, 50); assert.equal(h.states.at(-1).completed, false);
});

for (const raw of ['{', 'null', '{}', record(-1), record(101), record(1, false, 0), JSON.stringify({version:1,position:'12',duration:100,completed:false,updatedAt:1})]) {
  test(`ignores invalid saved data ${raw}`, () => {
    const storage = new MemoryStorage(); storage.setItem(key(), raw);
    const h = setup({ storage }); assert.equal(h.audio.currentTime, 0);
    seek(h.audio, 12); assert.equal(h.saved().position, 12);
  });
}

for (const failure of ['getter', 'setter']) {
  test(`storage ${failure} failure leaves playback operational and reports unavailable`, () => {
    const storage = new MemoryStorage();
    if (failure === 'setter') storage.setItem = () => { throw new Error('quota'); };
    const h = setup({ storage, blockedGetter: failure === 'getter' });
    assert.doesNotThrow(() => { h.audio.play(); seek(h.audio, 15); h.audio.pause(); });
    assert.equal(h.audio.currentTime, 15); assert.equal(h.states.at(-1).storageAvailable, false);
  });
}

test('untouched stale tab cannot overwrite another session on exit', () => {
  const storage = new MemoryStorage(); storage.setItem(key(), record(20));
  const stale = setup({ storage }); finishSeek(stale.audio);
  const active = setup({ storage }); finishSeek(active.audio); seek(active.audio, 65);
  stale.audio.pause(); emit(stale.window, 'pagehide'); stale.controller.destroy();
  assert.equal(active.saved().position, 65);
});

test('destroy flushes active progress and removes event subscriptions', () => {
  const h = setup(); h.audio.play(); h.audio.currentTime = 22; h.controller.destroy();
  assert.equal(h.saved().position, 22);
  h.audio.currentTime = 44; emit(h.window, 'pagehide'); h.audio.pause();
  assert.equal(h.saved().position, 22);
});
