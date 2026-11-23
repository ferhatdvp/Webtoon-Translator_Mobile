import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { AppError, ERR } from '../app/src/main/assets/web/shared/errors.js';
import { classifyGeminiError } from '../app/src/main/assets/web/background/providers/gemini.js';

const primary = 'gemini-3.5-flash-lite';
const fallback = 'gemini-3.1-flash-lite';
let moduleId = 0;

async function scenario(respond) {
  const state = {
    clock: 1000000, calls: [], reservations: [], releases: [], blocked: new Set(),
    settings: {
      gemini: { apiKey: 'mock', model: primary, fallbackModel: fallback },
      limits: { dailyRequestCap: 400, minIntervalMs: 5000, allowPaid: false },
      sourceLanguage: 'en',
    },
  };
  let chain = Promise.resolve();
  globalThis.availabilityTestDeps = {
    AppError, ERR, now: () => state.clock,
    isBlocked: async (model) => state.blocked.has(model),
    markBlocked: async (model) => state.blocked.add(model),
    reserve: async (model, limits) => {
      assert.equal(limits.dailyRequestCap, 400);
      state.reservations.push(model);
    },
    release: async (model) => state.releases.push(model),
    schedule: (_interval, fn) => {
      const request = chain.then(fn);
      chain = request.catch(() => {});
      return request;
    },
    callGemini: async (request) => {
      state.calls.push(request.model);
      return respond(request.model, state);
    },
    noteCooldown() {}, noteRateLimited() {}, noteSuccess() {}, logRequest() {},
  };
  const source = fs.readFileSync(new URL('../app/src/main/assets/web/background/pipeline.js', import.meta.url), 'utf8')
    .replace(/^import \{([^}]+)\} from '[^']+';/gm, (_, names) => 'const {' + names + '} = deps;');
  const wrapped = 'const deps = globalThis.availabilityTestDeps; const Date = {now: deps.now};\n' + source;
  const pipeline = await import('data:text/javascript;base64,' + Buffer.from(wrapped).toString('base64') + '#' + moduleId++);
  state.run = () => pipeline.runGemini({ base64: 'mock', mime: 'image/jpeg' }, state.settings);
  return state;
}

const overloaded = () => new AppError(ERR.SERVER, undefined, { status: 503 });

test('503 is a temporary provider error and preserves the diagnostic detail', () => {
  const error = classifyGeminiError(503, { error: { message: 'This model is currently experiencing high demand.' } });
  assert.equal(error.code, ERR.SERVER);
  assert.equal(error.status, 503);
  assert.match(error.detail, /high demand/);
});

test('configured fallback succeeds when the primary model is overloaded', async () => {
  const state = await scenario((model) => {
    if (model === primary) throw overloaded();
    return { items: [] };
  });
  assert.equal((await state.run()).model, fallback);
  assert.deepEqual(state.calls, [primary, fallback]);
  await state.run();
  assert.deepEqual(state.calls, [primary, fallback, fallback], 'cooling primary is not repeatedly called');
  assert.equal(state.settings.gemini.model, primary);
  assert.deepEqual(state.releases, [], 'failed requests are conservatively counted against local safety cap');
});

test('both models overloaded pauses automatically, avoids repeated calls and recovers', async () => {
  let available = false;
  const state = await scenario(() => {
    if (!available) throw overloaded();
    return { items: [] };
  });
  const busy = (error) => {
    assert.equal(error.code, ERR.SERVICE_BUSY);
    assert.equal(error.toJSON().fatal, true);
    assert.ok(error.retryAfterMs >= 5000 && error.retryAfterMs <= 30000);
    return true;
  };
  await assert.rejects(state.run(), busy);
  await assert.rejects(state.run(), busy);
  assert.deepEqual(state.calls, [primary, fallback]);
  assert.equal(state.reservations.length, 2);
  assert.equal(state.blocked.size, 0, 'temporary demand is not marked as exhausted daily quota');
  state.clock += 31000;
  available = true;
  assert.equal((await state.run()).model, primary);
});

test('disabled fallback is respected', async () => {
  const state = await scenario(() => { throw overloaded(); });
  state.settings.gemini.fallbackModel = '';
  await assert.rejects(state.run(), (error) => error.code === ERR.SERVICE_BUSY);
  assert.deepEqual(state.calls, [primary]);
});

test('daily quota handling still uses only the configured fallback', async () => {
  const state = await scenario((model) => {
    if (model === primary) throw new AppError(ERR.QUOTA_DAILY);
    return { items: [] };
  });
  assert.equal((await state.run()).model, fallback);
  assert.deepEqual(state.releases, [primary]);
  assert.ok(state.blocked.has(primary));
});

test('authentication failure stops without trying another model', async () => {
  const state = await scenario(() => { throw new AppError(ERR.AUTH); });
  await assert.rejects(state.run(), (error) => error.code === ERR.AUTH);
  assert.deepEqual(state.calls, [primary]);
});

test('temporary overload can recover even if the other model has a local cap', async () => {
  const state = await scenario((model) => {
    throw model === primary ? overloaded() : new AppError(ERR.LOCAL_CAP);
  });
  await assert.rejects(state.run(), (error) => error.code === ERR.SERVICE_BUSY);
  assert.deepEqual(state.calls, [primary, fallback]);
});

test('page keeps a busy image queued and automatically translates it after waiting', async () => {
  class Element {
    children = []; style = {}; events = {}; isConnected = true; classList = { toggle() {} };
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(name, handler) { this.events[name] = handler; }
    toggleAttribute() {}
    attachShadow() { return this.shadow = new Element(); }
    remove() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600, bottom: 600 }; }
  }
  class Img extends Element {
    complete = true; naturalWidth = 800; naturalHeight = 600; src = 'https://reader.test/image.jpg';
  }
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const messages = [], timers = new Map(), documentRoot = new Element(), image = new Img();
  let timerId = 0;
  const bridge = { postMessage: (message) => messages.push(JSON.parse(message)) };
  const context = {
    document: { documentElement: documentRoot, createElement: () => new Element(), querySelectorAll: () => [image] },
    HTMLImageElement: Img, IntersectionObserver: Observer, ResizeObserver: Observer, MutationObserver: Observer,
    CSSStyleSheet: class { replaceSync() {} }, __wttBridge: bridge,
    localStorage: { getItem: () => null }, location: new URL('https://reader.test/chapter/1'),
    URL, console, innerWidth: 400, innerHeight: 700, addEventListener() {},
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id), setInterval: () => 1, clearInterval() {},
  };
  context.window = context; context.top = context;
  vm.runInNewContext(fs.readFileSync(new URL('../app/src/main/assets/web/mobile/page-bundle.js', import.meta.url), 'utf8'), context);
  const reply = (id, res) => bridge.onmessage({ data: JSON.stringify({ id, res }) });
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  const config = { ok: true, allowed: true, enabled: true, sourceLanguage: 'en',
    render: { prefetch: 'all', minImageWidth: 300, minImageHeight: 200 } };
  reply(messages.find((m) => m.msg?.type === 'GET_PAGE_CONFIG').id, config);
  await turn();
  const translate = messages.find((m) => m.msg?.type === 'TRANSLATE_IMAGE');
  reply(translate.id, { ok: false, error: new AppError(ERR.SERVICE_BUSY, undefined, { retryAfterMs: 30000 }).toJSON() });
  await turn();
  const status = () => messages.filter((m) => m.status).at(-1).status;
  assert.equal(status().paused, true);
  assert.equal(status().failed, 0);
  assert.equal(status().busy, 1);
  const wait = [...timers.values()].find((timer) => timer.ms === 30000);
  assert.ok(wait, 'busy image must be scheduled for automatic resume');
  wait.fn();
  reply(messages.filter((m) => m.msg?.type === 'GET_PAGE_CONFIG').at(-1).id, config);
  await turn();
  const retry = messages.filter((m) => m.msg?.type === 'TRANSLATE_IMAGE').at(-1);
  assert.notEqual(retry.id, translate.id);
  assert.equal(retry.msg.url, image.src);
  reply(retry.id, { ok: true, result: { boxes: [] } });
  await turn();
  assert.equal(status().paused, false);
  assert.equal(status().done, 1);
  assert.equal(status().failed, 0);
});
