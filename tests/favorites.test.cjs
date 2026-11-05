const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const menu = JSON.parse(fs.readFileSync(path.join(root, 'menu.json'), 'utf8'));
const nodes = new Map(), listeners = {}, timers = [], rows = [], calls = [];
let nextError = null, deferred = null;
class Element {
  constructor() { this.children = []; this.handlers = {}; this.value = ''; this.classList = {add(){}, remove(){}}; }
  set id(value) { this._id = value; nodes.set(value, this); }
  get id() { return this._id; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(event, fn) { this.handlers[event] = fn; }
  showModal() { this.open = true; }
  close() { this.open = false; this.handlers.close?.(); }
  focus() {}
  reset() {}
  reportValidity() { return true; }
}
for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], new Element());
const sections = new Map();
function query() {
  let operation = 'select', payload, filters = [];
  const chain = {
    select() { return chain; },
    insert(value) { operation = 'insert'; payload = value; return chain; },
    delete() { operation = 'delete'; return chain; },
    eq(key, value) { filters.push([key, value]); return chain; },
    single() { return chain; },
    then(resolve, reject) {
      calls.push({operation, payload, filters});
      if (deferred) { const wait = deferred; deferred = null; return wait.then(resolve, reject); }
      if (nextError) { const error = nextError; nextError = null; return Promise.resolve({error}).then(resolve, reject); }
      const matches = row => filters.every(([key, value]) => row[key] === value);
      let data;
      if (operation === 'insert') { rows.push(payload); data = payload; }
      else if (operation === 'delete') { data = rows.filter(matches); for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i])) rows.splice(i, 1); }
      else data = rows.filter(matches);
      return Promise.resolve({data, error:null}).then(resolve, reject);
    }
  };
  return chain;
}
const client = {from: name => { assert.equal(name, 'favorites'); return query(); }, auth:{onAuthStateChange(){}}};
const context = {
  console, Date, Set, Map, Math,
  setTimeout: fn => timers.push(fn),
  document: {
    body: new Element(),
    getElementById: id => nodes.get(id) || null,
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
    querySelector: selector => { if (!sections.has(selector)) sections.set(selector, new Element()); return sections.get(selector); },
    addEventListener: (key, fn) => { listeners[key] = fn; }
  },
  window:{supabase:{createClient:()=>client},location:{origin:'http://127.0.0.1:3000',pathname:'/'}},
  fetch: async () => ({ok:true,json:async()=>menu})
};
vm.createContext(context);
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1], context);
const run = code => vm.runInContext(code, context);
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  await tick();
  run('openRecipe(state.data.recipes[0],null)');
  await run('toggleFavorite(state.data.recipes[0])');
  assert.equal(calls.length, 0, 'anonymous users do not write');
  assert.match(nodes.get('favorite-feedback').textContent, /로그인하면/);
  rows.push({user_id:'user-a',recipe_id:menu.recipes[1].id});
  run('syncFavoriteUser("user-a")');
  timers.splice(0).forEach(fn => fn()); await tick();
  assert.deepEqual([...run('favorites.ids')], [menu.recipes[1].id]);
  await run('toggleFavorite(state.data.recipes[0])');
  assert.equal(run('favorites.ids.has(state.data.recipes[0].id)'), true);
  assert.equal(nodes.get('favorite-toggle')['aria-pressed'], 'true');
  run('favorites.view=true;renderFavoritesView()');
  assert.equal(nodes.get('favorites-recipes').children.length, 2);
  await run('toggleFavorite(state.data.recipes[0])');
  assert.equal(nodes.get('favorites-recipes').children.length, 1);
  assert.equal(run('favorites.ids.has(state.data.recipes[0].id)'), false);
  const deletion = calls.find(call => call.operation === 'delete');
  assert(deletion.filters.some(([key,value]) => key === 'user_id' && value === 'user-a'));
  nextError = {code:'42501'};
  await run('toggleFavorite(state.data.recipes[0])');
  assert.equal(run('favorites.ids.has(state.data.recipes[0].id)'), false, 'failed writes do not look saved');
  assert.match(run('favorites.error'), /RLS/);
  nextError = {code:'PGRST205'};
  await run('loadFavorites()');
  assert.match(run('favorites.error'), /supabase-favorites.sql/);
  let finishRead;
  deferred = new Promise(resolve => { finishRead = resolve; });
  const oldRead = run('loadFavorites()');
  await tick();
  run('syncFavoriteUser("user-b")');
  finishRead({data:[{recipe_id:menu.recipes[0].id}],error:null});
  await oldRead;
  assert.equal(run('favorites.ids.size'), 0, 'old account response is discarded');
  timers.splice(0).forEach(fn => fn()); await tick();
  let finishWrite;
  deferred = new Promise(resolve => { finishWrite = resolve; });
  const oldWrite = run('toggleFavorite(state.data.recipes[0])');
  await tick();
  const callCount = calls.length;
  await run('toggleFavorite(state.data.recipes[0])');
  assert.equal(calls.length, callCount, 'double click does not write twice');
  run('syncFavoriteUser(null)');
  finishWrite({data:{recipe_id:menu.recipes[0].id},error:null});
  await oldWrite;
  assert.equal(run('favorites.ids.size'), 0, 'late save cannot repopulate signed-out favorites');
  assert.match(nodes.get('favorites-status').textContent, /로그인하면/);
  console.log('PASS: anonymous access, load, save, delete, saved-only cards, RLS errors, missing table, account isolation, duplicate clicks, logout race');
})().catch(error => { console.error(error); process.exitCode = 1; });
