/**
 * Client-half smoke test, outside the browser: load client.js through a mock
 * __ModuleLoader__, run apply() against a mock cordis context, and render the
 * registered settings page and card with a minimal React mock. Catches
 * registration-shape and render-path errors without a DOM.
 */

const registrations = []
const disposers = []

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useCallback: fn => fn,
  useSyncExternalStore: (_subscribe, read) => read(),
  useId: () => 'test-id',
  useRef: initial => ({ current: initial }),
}

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(entry) { loaded = entry },
  },
}
globalThis.document = {
  createElement: () => ({ dataset: {}, remove() {} }),
  head: { appendChild() {} },
}

await import('../client.js')
if (!loaded || loaded.id !== 'dsh-exa-tools') throw new Error('client module did not register under its package id')
const plugin = loaded.factory(specifier => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require: ${specifier}`)
})
console.log('factory ok; inject:', plugin.inject.join(', '))

const form = {
  subscribe: () => () => {},
  getSnapshot: () => ({
    status: 'ready',
    value: { searchMaxResults: 10, fetchMaxCharacters: 50000, searchTimeoutMs: 30000, fetchTimeoutMs: 60000, fallbackToFree: true },
    base: { searchMaxResults: 10, fetchMaxCharacters: 50000, searchTimeoutMs: 30000, fetchTimeoutMs: 60000, fallbackToFree: true },
    revision: 3,
    writable: true,
  }),
  mutate: async () => true,
  unset: async () => true,
}
const mirror = {
  subscribe: () => () => {},
  getSnapshot: () => ({ view: { namespaces: [{ ns: 'exa-tools', secrets: [{ path: ['apiKey'], set: false }] }] } }),
}
const t = key => `[${key}]`

const ctx = {
  locale: {
    register: () => () => {},
    bind: () => t,
    subscribe: () => () => {},
  },
  effect(gen) {
    const iterator = gen()
    let step
    while (!(step = iterator.next()).done) {
      if (typeof step.value === 'function') disposers.push(step.value)
    }
  },
  configForms: {
    get: id => { if (id !== 'exa-tools') throw new Error(`wrong namespace: ${id}`); return form },
    describe: () => mirror,
    whileServed: (namespaces, register) => {
      if (!namespaces.includes('exa-tools')) throw new Error('whileServed watches the wrong namespace')
      return register()
    },
  },
  slots: {
    inject: (_key, register) => register(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

plugin.apply(ctx)

const names = registrations.map(r => `${r.options.name}${r.options.key ? ` key=${r.options.key}` : ''}${r.options.id ? ` id=${r.options.id}` : ''}`)
console.log('registrations:', names.join(' | '))
for (const expected of ['settings.section', 'settings.section.icon', 'plugins.bundle.config']) {
  if (!registrations.some(r => r.options.name === expected)) throw new Error(`missing registration: ${expected}`)
}
const section = registrations.find(r => r.options.name === 'settings.section')
if (section.options.id !== 'exa-tools') throw new Error('section id must equal the settings namespace')
if (typeof section.options.label !== 'function' || !section.options.label()) throw new Error('section label must be a thunk')
const icon = registrations.find(r => r.options.name === 'settings.section.icon')
if (icon.options.id !== section.options.id) throw new Error('icon id must match the section id')

// Render the settings page and the icon through the React mock.
const injected = section.options.inject()
const page = section.component({ ...injected, close: () => {} })
if (!page || page.type !== 'div') throw new Error('settings page did not render a container')
const iconNode = icon.component({ size: 18, active: false })
if (!iconNode || iconNode.type !== 'svg') throw new Error('nav icon did not render an svg')
const card = registrations.find(r => r.options.name === 'plugins.bundle.config')
const cardNode = card.component({ ...card.options.inject(), t, view: 'page' })
if (!cardNode || cardNode.type !== 'div') throw new Error('bundle config card did not render')

for (const dispose of disposers.reverse()) dispose()
console.log('\nCLIENT TEST OK')
