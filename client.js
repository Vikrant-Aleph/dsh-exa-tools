/**
 * dsh-exa-tools — client half (runs in the Web and Desktop renderers).
 *
 * Registers the plugin's configuration card into the Plugins page's
 * `plugins.bundle.config` slot (keyed by this package name), so the bundle's
 * page shows an API key form between its description and its rows. Values
 * read and write through the shared settings transport (`ctx.configForms`);
 * the API key is a write-only secret: the Host never returns its value, only
 * a set/unset presence marker, which this card renders as the input's
 * placeholder state.
 *
 * Controls are self-contained and styled with the host theme tokens
 * (--dsw-alias-*); no Harness Client package is imported as a module.
 */

window.__ModuleLoader__.load({
  id: 'dsh-exa-tools',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useCallback, useSyncExternalStore, useId, useRef } = React

    const PKG = 'dsh-exa-tools'
    const NS = 'exaTools'
    const ENTRY_ID = 'exa-tools'

    const DICTS = {
      en: {
        nav: 'Exa tools',
        pageTitle: 'Exa search tools',
        intro: 'Exa powers exa_search and exa_fetch. Without a key the tools use Exa\'s free hosted endpoint (rate-limited); with a key they use the official Exa API.',
        modeApi: 'API mode — official Exa API (api.exa.ai)',
        modeFree: 'Free mode — hosted MCP endpoint (mcp.exa.ai)',
        modeFreeHint: 'The free endpoint is rate-limited. Add an API key for higher limits.',
        keyLabel: 'API key',
        keyHint: 'The key is stored in this profile\'s configuration and never shown again after saving.',
        keyLink: 'Get an API key',
        keyPlaceholderSet: 'Key configured — type to replace',
        keyPlaceholderUnset: 'Paste your Exa API key',
        keyReveal: 'Show key',
        keyHide: 'Hide key',
        advanced: 'Limits and timeouts',
        advancedHint: 'Leave a field empty and save to restore its default.',
        searchMaxResults: 'Max search results',
        fetchMaxCharacters: 'Max fetch characters',
        searchTimeoutMs: 'Search timeout (ms)',
        fetchTimeoutMs: 'Fetch timeout (ms)',
        default: 'default',
        save: 'Save',
        saving: 'Saving…',
        clearKey: 'Clear API key',
        clearing: 'Clearing…',
        saved: 'Saved. Changes apply immediately.',
        cleared: 'API key cleared. The tools now use the free endpoint.',
        noChanges: 'No changes to save.',
        refused: 'The configuration was updated elsewhere; the latest values were reloaded. Your drafts are kept — review them and save again.',
        saveFailed: 'Save failed: ',
        invalidNumber: 'enter a whole number in the allowed range',
        loading: 'Loading configuration…',
        unavailable: 'The Exa tools plugin is not active in this profile.',
        readonly: 'This profile\'s configuration is read-only here.',
      },
      zh: {
        nav: 'Exa 搜索',
        pageTitle: 'Exa 搜索工具',
        intro: 'Exa 为 exa_search 和 exa_fetch 提供支持。未填写 API Key 时使用 Exa 免费托管端点（有速率限制）；填写后改用 Exa 官方 API。',
        modeApi: 'API 模式 —— Exa 官方 API（api.exa.ai）',
        modeFree: '免费模式 —— 托管 MCP 端点（mcp.exa.ai）',
        modeFreeHint: '免费端点有速率限制。填写 API Key 可获得更高限额。',
        keyLabel: 'API Key',
        keyHint: '密钥保存在本 profile 的配置中，保存后不再回显。',
        keyLink: '获取 API Key',
        keyPlaceholderSet: '已配置 —— 输入新值可替换',
        keyPlaceholderUnset: '粘贴 Exa API Key',
        keyReveal: '显示密钥',
        keyHide: '隐藏密钥',
        advanced: '限额与超时',
        advancedHint: '清空某字段并保存即恢复其默认值。',
        searchMaxResults: '搜索最大结果数',
        fetchMaxCharacters: '抓取最大字符数',
        searchTimeoutMs: '搜索超时（毫秒）',
        fetchTimeoutMs: '抓取超时（毫秒）',
        default: '默认',
        save: '保存',
        saving: '保存中…',
        clearKey: '清除 API Key',
        clearing: '清除中…',
        saved: '已保存，立即生效。',
        cleared: '已清除 API Key，工具改用免费端点。',
        noChanges: '没有需要保存的改动。',
        refused: '配置已被其他改动更新，最新值已重新载入。草稿已保留，请核对后重新保存。',
        saveFailed: '保存失败：',
        invalidNumber: '请输入允许范围内的整数',
        loading: '正在加载配置…',
        unavailable: 'Exa 工具插件未在本 profile 中启用。',
        readonly: '本 profile 的配置在此只读。',
      },
    }

    /**
     * Numeric volatile fields with their schema ranges and defaults, in form
     * order. Kept in sync with the Config schema in index.js by hand; the
     * ranges are also validated Host-side on every write.
     */
    const NUM_FIELDS = [
      { name: 'searchMaxResults', min: 1, max: 50, def: 10 },
      { name: 'fetchMaxCharacters', min: 1000, max: 500000, def: 50000 },
      { name: 'searchTimeoutMs', min: 1000, max: 300000, def: 30000 },
      { name: 'fetchTimeoutMs', min: 1000, max: 300000, def: 60000 },
    ]

    const EYE_CONTOUR = 'M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8Z'
    const EYE_PATH = `${EYE_CONTOUR}M10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z`
    const EYE_OFF_PATH = `${EYE_CONTOUR}M2.5 2.5L13.5 13.5`

    const STYLE = `
.dsh-exa-page { display: flex; flex-direction: column; gap: 16px; max-width: 720px; color: var(--dsw-alias-label-primary); }
.dsh-exa-page-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsh-exa-card { display: flex; flex-direction: column; gap: 12px; max-width: 720px; color: var(--dsw-alias-label-primary); }
.dsh-exa-intro { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); }
.dsh-exa-mode { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; }
.dsh-exa-dot { box-sizing: border-box; display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; corner-shape: round; }
.dsh-exa-dot-on { background: var(--dsw-alias-state-success-primary); }
.dsh-exa-dot-off { background: var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-tertiary)); }
.dsh-exa-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsh-exa-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-exa-label { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dsh-exa-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dsh-exa-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsh-exa-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dsh-exa-input:disabled { opacity: 0.6; cursor: default; }
.dsh-exa-input[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-exa-input-filled { padding-right: 40px; }
.dsh-exa-keyrow { position: relative; }
.dsh-exa-keytoggle { position: absolute; inset: 1px 1px 1px auto; display: inline-flex; align-items: center; justify-content: center; width: 32px; padding: 0; border: none; border-radius: var(--dsw-radius-md); background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }
@media (hover: hover) { .dsh-exa-keytoggle:hover:not(:disabled) { color: var(--dsw-alias-label-primary); } }
.dsh-exa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.dsh-exa-range { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.dsh-exa-actions { display: flex; align-items: center; gap: 8px; }
.dsh-exa-primary, .dsh-exa-danger { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.dsh-exa-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
@media (hover: hover) { .dsh-exa-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); } }
.dsh-exa-danger { background: transparent; color: var(--dsw-alias-state-error-primary); }
@media (hover: hover) { .dsh-exa-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); } }
.dsh-exa-primary:disabled, .dsh-exa-danger:disabled { opacity: 0.4; cursor: default; }
.dsh-exa-primary:focus-visible, .dsh-exa-danger:focus-visible, .dsh-exa-keytoggle:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dsh-exa-saved { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
.dsh-exa-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.dsh-exa-advanced { border-top: 0.5px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.dsh-exa-advanced summary { display: flex; align-items: center; gap: 6px; width: fit-content; cursor: pointer; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); list-style: none; }
.dsh-exa-advanced summary::-webkit-details-marker { display: none; }
.dsh-exa-advanced summary::before { content: ''; width: 5px; height: 5px; border-right: 1.5px solid currentcolor; border-bottom: 1.5px solid currentcolor; transform: rotate(-45deg) translate(-1px, -1px); transition: transform 120ms ease; }
.dsh-exa-advanced[open] summary::before { transform: rotate(45deg) translate(-1px, -1px); }
.dsh-exa-advanced-body { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; }
.dsh-exa-link { color: var(--dsw-alias-state-business-primary); text-decoration: none; }
@media (hover: hover) { .dsh-exa-link:hover { text-decoration: underline; } }
@media (prefers-reduced-motion: reduce) { .dsh-exa-advanced summary::before { transition: none; } }
`

    /** The bundle-page configuration card. Props: t, view, form, mirror. */
    function ExaConfigCard(props) {
      const { t, form, mirror } = props
      const subscribeForm = useCallback(listener => form.subscribe(listener), [form])
      const readForm = useCallback(() => form.getSnapshot(), [form])
      const subscribeMirror = useCallback(listener => mirror.subscribe(listener), [mirror])
      const readMirror = useCallback(() => mirror.getSnapshot(), [mirror])
      const snap = useSyncExternalStore(subscribeForm, readForm)
      const mirrorSnap = useSyncExternalStore(subscribeMirror, readMirror)

      const idPrefix = useId()
      const fieldRefs = useRef({})
      const [drafts, setDrafts] = useState({})
      // Revision read when editing began: the fence against concurrent writes.
      // Reset after a settled write; a refusal also resets it so an informed
      // retry (the message says the latest values were reloaded) can proceed.
      const [baseRevision, setBaseRevision] = useState(undefined)
      const [busyAction, setBusyAction] = useState(null)
      const [message, setMessage] = useState(null)
      const [revealed, setRevealed] = useState(false)
      const [invalidField, setInvalidField] = useState(null)
      const [advancedOpen, setAdvancedOpen] = useState(false)

      const nsView = mirrorSnap.view?.namespaces?.find(candidate => candidate.ns === ENTRY_ID)
      const keySet = nsView?.secrets?.some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set) === true

      if (snap.status === 'loading') return h('p', { className: 'dsh-exa-hint' }, t('loading'))
      if (snap.status === 'unavailable') return h('p', { className: 'dsh-exa-hint' }, t('unavailable'))

      const value = snap.value ?? {}
      const base = snap.base ?? {}
      const writable = snap.writable
      const busy = busyAction !== null
      const disabled = !writable || busy
      const keyDraft = drafts.apiKey ?? ''
      const messageId = `${idPrefix}-message`
      const draftText = field => drafts[field] ?? (value[field] !== undefined ? String(value[field]) : '')

      // Dirty check normalizes numeric drafts the same way save parses them,
      // so "10.0" or "010" never light up Save for a no-op.
      let dirty = keyDraft.trim().length > 0
      for (const field of NUM_FIELDS) {
        const draft = drafts[field.name]
        if (draft === undefined) continue
        const text = draft.trim()
        if (text === '') { if (value[field.name] !== undefined) dirty = true; continue }
        if (!/^\d+$/.test(text)) { dirty = true; continue }
        if (Number(text) !== value[field.name]) dirty = true
      }

      const edit = (field, text) => {
        if (baseRevision === undefined) setBaseRevision(snap.revision)
        setDrafts(current => ({ ...current, [field]: text }))
        setMessage(null)
        setInvalidField(null)
        if (field === 'apiKey') setRevealed(false)
      }

      const save = async () => {
        if (busy || !writable) return
        const ops = []
        const trimmedKey = keyDraft.trim()
        if (trimmedKey) ops.push({ op: 'set', path: ['apiKey'], value: trimmedKey })
        let firstInvalid = null
        for (const field of NUM_FIELDS) {
          const draft = drafts[field.name]
          if (draft === undefined) continue
          const text = draft.trim()
          if (text === '') {
            if (value[field.name] !== undefined) ops.push({ op: 'unset', path: [field.name] })
            continue
          }
          const number = /^\d+$/.test(text) ? Number(text) : NaN
          if (!Number.isInteger(number) || number < field.min || number > field.max) {
            firstInvalid ??= field
            continue
          }
          if (number !== value[field.name]) ops.push({ op: 'set', path: [field.name], value: number })
        }
        if (firstInvalid) {
          setInvalidField(firstInvalid.name)
          setAdvancedOpen(true)
          setMessage({ kind: 'err', text: `${t(firstInvalid.name)}: ${t('invalidNumber')} (${firstInvalid.min}–${firstInvalid.max})` })
          // Focus the offending input once the expanded details has rendered.
          setTimeout(() => { fieldRefs.current[firstInvalid.name]?.focus() }, 0)
          return
        }
        if (ops.length === 0) {
          setMessage({ kind: 'ok', text: t('noChanges') })
          return
        }
        setBusyAction('save')
        try {
          const accepted = await form.mutate(ops, baseRevision ?? snap.revision)
          if (accepted) {
            setMessage({ kind: 'ok', text: t('saved') })
            setDrafts({})
            setRevealed(false)
            setInvalidField(null)
          } else {
            // The transport already reloaded the latest Host values; drafts
            // stay for review. Drop the stale fence so a retry can proceed.
            setMessage({ kind: 'err', text: t('refused') })
          }
          setBaseRevision(undefined)
        } catch (error) {
          setMessage({ kind: 'err', text: t('saveFailed') + (error?.message ?? String(error)) })
        } finally {
          setBusyAction(null)
        }
      }

      const clearKey = async () => {
        if (busy || !writable) return
        setBusyAction('clear')
        try {
          const accepted = await form.unset('apiKey')
          if (accepted) {
            setMessage({ kind: 'ok', text: t('cleared') })
            setDrafts(current => {
              const next = { ...current }
              delete next.apiKey
              return next
            })
            setRevealed(false)
          } else {
            setMessage({ kind: 'err', text: t('refused') })
          }
          setBaseRevision(undefined)
        } catch (error) {
          setMessage({ kind: 'err', text: t('saveFailed') + (error?.message ?? String(error)) })
        } finally {
          setBusyAction(null)
        }
      }

      const canReveal = keyDraft.length > 0 && !disabled
      const showText = canReveal && revealed
      const keyInputId = `${idPrefix}-api-key`

      return h('div', { className: 'dsh-exa-card' },
        h('p', { className: 'dsh-exa-intro' }, t('intro')),
        h('span', { className: 'dsh-exa-mode' },
          h('span', { className: `dsh-exa-dot ${keySet ? 'dsh-exa-dot-on' : 'dsh-exa-dot-off'}`, 'aria-hidden': true }),
          keySet ? t('modeApi') : t('modeFree')),
        keySet ? null : h('p', { className: 'dsh-exa-hint' }, t('modeFreeHint')),
        h('div', { className: 'dsh-exa-field' },
          h('label', { className: 'dsh-exa-label', htmlFor: keyInputId }, t('keyLabel')),
          h('div', { className: 'dsh-exa-keyrow' },
            h('input', {
              id: keyInputId,
              className: `dsh-exa-input${keyDraft.length > 0 ? ' dsh-exa-input-filled' : ''}`,
              type: showText ? 'text' : 'password',
              autoComplete: 'new-password',
              value: keyDraft,
              placeholder: keySet ? t('keyPlaceholderSet') : t('keyPlaceholderUnset'),
              disabled,
              onChange: event => edit('apiKey', event.target.value),
            }),
            canReveal ? h('button', {
              type: 'button',
              className: 'dsh-exa-keytoggle',
              'aria-label': t(showText ? 'keyHide' : 'keyReveal'),
              'aria-pressed': showText,
              onClick: () => setRevealed(current => !current),
            }, h('svg', {
              width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
              stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', 'aria-hidden': true,
            }, h('path', { d: showText ? EYE_OFF_PATH : EYE_PATH }))) : null),
          h('p', { className: 'dsh-exa-hint' },
            t('keyHint'), ' ',
            h('a', {
              className: 'dsh-exa-link',
              href: 'https://dashboard.exa.ai/api-keys',
              target: '_blank',
              rel: 'noreferrer',
            }, t('keyLink')))),
        h('details', {
          className: 'dsh-exa-advanced',
          open: advancedOpen,
          onToggle: event => setAdvancedOpen(event.currentTarget.open),
        },
          h('summary', null, t('advanced')),
          h('div', { className: 'dsh-exa-advanced-body' },
            h('p', { className: 'dsh-exa-hint' }, t('advancedHint')),
            h('div', { className: 'dsh-exa-grid' },
              NUM_FIELDS.map(field => {
                const inputId = `${idPrefix}-${field.name}`
                const rangeId = `${idPrefix}-range-${field.name}`
                const invalid = invalidField === field.name
                const describedBy = invalid ? `${rangeId} ${messageId}` : rangeId
                return h('div', { className: 'dsh-exa-field', key: field.name },
                  h('label', { className: 'dsh-exa-label', htmlFor: inputId }, t(field.name)),
                  h('input', {
                    id: inputId,
                    ref: (element) => { fieldRefs.current[field.name] = element },
                    className: 'dsh-exa-input',
                    type: 'text',
                    inputMode: 'numeric',
                    value: draftText(field.name),
                    disabled,
                    'aria-invalid': invalid || undefined,
                    'aria-describedby': describedBy,
                    onChange: event => edit(field.name, event.target.value),
                  }),
                  h('span', { className: 'dsh-exa-range', id: rangeId },
                    `${field.min}–${field.max} · ${t('default')} ${base[field.name] ?? field.def}`))
              })))),
        h('div', { className: 'dsh-exa-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-exa-primary',
            disabled: disabled || !dirty,
            onClick: () => { void save() },
          }, busyAction === 'save' ? t('saving') : t('save')),
          keySet ? h('button', {
            type: 'button',
            className: 'dsh-exa-danger',
            disabled,
            onClick: () => { void clearKey() },
          }, busyAction === 'clear' ? t('clearing') : t('clearKey')) : null),
        writable ? null : h('p', { className: 'dsh-exa-hint' }, t('readonly')),
        message ? h('p', {
          id: messageId,
          className: message.kind === 'ok' ? 'dsh-exa-saved' : 'dsh-exa-error',
          role: message.kind === 'err' ? 'alert' : 'status',
          'aria-live': message.kind === 'err' ? 'assertive' : 'polite',
        }, message.text) : null)
    }

    /**
     * Navigation icon for the settings section, addressed by the matching
     * section id. The shell owns the button, label, and row color; the mark
     * draws in currentColor so it follows the nav row's resting/active tone.
     */
    function ExaSettingsIcon(props) {
      const size = props.size
      return h('svg', {
        width: size, height: size, viewBox: '0 0 36 36', fill: 'none', 'aria-hidden': true,
      },
        h('path', { d: 'M21.2 21.2L28.6 28.6', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
        h('circle', { cx: 15, cy: 15, r: 8.5, stroke: 'currentColor', strokeWidth: 2.5 }),
        h('g', { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' },
          h('path', { d: 'M11.8 13.2L17.8 12.2' }),
          h('path', { d: 'M11.8 13.2L15.2 18.4' }),
          h('path', { d: 'M17.8 12.2L15.2 18.4' })),
        h('g', { fill: 'currentColor' },
          h('circle', { cx: 11.8, cy: 13.2, r: 1.5 }),
          h('circle', { cx: 17.8, cy: 12.2, r: 1.5 }),
          h('circle', { cx: 15.2, cy: 18.4, r: 1.5 })))
    }

    /** The Settings-panel page: a heading over the same configuration card. */
    function ExaSettingsPage(props) {
      const { t, form, mirror } = props
      return h('div', { className: 'dsh-exa-page' },
        h('h2', { className: 'dsh-exa-page-title' }, t('pageTitle')),
        h(ExaConfigCard, { t, form, mirror }))
    }

    return {
      name: 'exa-tools-client',
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(function* () {
          yield ctx.locale.register(NS, DICTS)
          const t = ctx.locale.bind(NS)
          const style = document.createElement('style')
          style.dataset.plugin = PKG
          style.textContent = STYLE
          document.head.appendChild(style)
          const form = ctx.configForms.get(ENTRY_ID)
          const mirror = ctx.configForms.describe()
          // The card exists while the Host serves this plugin's settings
          // namespace; a profile without the plugin shows no trace of it.
          yield ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
            name: 'plugins.bundle.config',
            key: PKG,
            locale: NS,
            inject: () => ({ form, mirror }),
          }, ExaConfigCard)))
          // A standalone page in the Settings panel navigation. The shell
          // never subscribes locale state, so re-register with a fresh label
          // whenever the locale changes.
          const registerSection = () => ctx.slots.register({
            name: 'settings.section',
            id: ENTRY_ID,
            order: 35,
            label: () => t('nav'),
            inject: () => ({ form, mirror, t }),
          }, ExaSettingsPage)
          let sectionOff = registerSection()
          yield ctx.locale.subscribe(() => {
            try {
              sectionOff()
              sectionOff = registerSection()
            } catch { /* the shell may be mid-reload; the next locale event retries */ }
          })
          yield () => { sectionOff() }
          yield ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon',
            id: ENTRY_ID,
          }, ExaSettingsIcon))
          yield () => { style.remove() }
        }, 'dsh-exa-tools client lifecycle')
      },
    }
  },
})
