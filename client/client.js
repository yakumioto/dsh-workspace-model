/**
 * Browser half of the per-workspace default model plugin.
 *
 * Adds "默认模型…" to a workspace's context menu. The dialog reads the live
 * model catalog and the plugin's settings namespace, then writes one array:
 * the workspace is present when it has an override and absent when it should
 * follow the deployment default.
 *
 * @module @yakumioto/dsh-workspace-model/client
 */
window.__ModuleLoader__.load({
  id: '@yakumioto/dsh-workspace-model',
  factory: (require) => {
    const React = require('react')
    const { Button, Modal, IconDataOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const SEP = '\u0000'
    const LOCALE_NS = 'workspace-model'
    const SETTINGS_NS = 'workspace-model'

    const zh = {
      'menu.open': '默认模型',
      'dialog.title': '设置默认模型',
      'dialog.hint': '「{name}」新建的会话会使用这里选的模型。',
      'dialog.follow': '跟随全局默认（{model}）',
      'dialog.model': '模型',
      'dialog.effort': '推理等级',
      'dialog.effortDefault': '默认',
      'dialog.loading': '正在读取可用模型…',
      'dialog.loadFailed': '没能读取模型列表：{message}',
      'dialog.retry': '重试',
      'dialog.empty': '现在没有可用的模型。请先在「设置 → 模型」里添加模型。',
      'dialog.stale': '之前选的模型已经不在可用列表里。重新选一个，或改为跟随全局默认。',
      'dialog.cancel': '取消',
      'dialog.save': '保存',
      'dialog.saving': '正在保存…',
      'dialog.saved': '已保存。这个工作区新建的会话会使用新的默认模型。',
      'dialog.saveFailed': '没能保存：{message}',
      'dialog.conflict': '设置刚在别处改过。关掉重开就能看到最新内容，再保存一次。',
      'dialog.close': '关闭',
      'dialog.missing': '这个设置还没准备好，请稍后重试。',
    }

    const en = {
      'menu.open': 'Default model',
      'dialog.title': 'Set default model',
      'dialog.hint': 'New sessions in “{name}” will start with the model you pick here.',
      'dialog.follow': 'Follow the global default ({model})',
      'dialog.model': 'Model',
      'dialog.effort': 'Reasoning effort',
      'dialog.effortDefault': 'Default',
      'dialog.loading': 'Reading available models…',
      'dialog.loadFailed': 'Could not read the model list: {message}',
      'dialog.retry': 'Try again',
      'dialog.empty': 'No models are available. Add one in Settings → Models first.',
      'dialog.stale': 'The previously chosen model is no longer available. Pick another one, or follow the global default.',
      'dialog.cancel': 'Cancel',
      'dialog.save': 'Save',
      'dialog.saving': 'Saving…',
      'dialog.saved': 'Saved. New sessions in this workspace will use the new default model.',
      'dialog.saveFailed': 'Could not save: {message}',
      'dialog.conflict': 'These settings changed elsewhere. Close and reopen this dialog to see the latest values, then save again.',
      'dialog.close': 'Close',
      'dialog.missing': 'This setting is not ready yet. Please try again in a moment.',
    }

    const css = `
      .wdm-body { display: flex; flex-direction: column; gap: 12px; }
      .wdm-field { display: flex; flex-direction: column; gap: 6px; }
      .wdm-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, currentColor); }
      .wdm-select { box-sizing: border-box; width: 100%; height: 44px; padding: 7px 14px;
        border: 0.5px solid var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 22%, transparent));
        border-radius: var(--dsw-radius-lg, 12px); outline: none; background: transparent;
        color: var(--dsw-alias-label-primary, currentColor);
        font-family: inherit; font-size: 14px; font-weight: 400; line-height: 22px; }
      .wdm-select:disabled { color: var(--dsw-alias-label-dimmed, currentColor); }
      .wdm-select:focus-visible { border-color: var(--dsw-alias-border-l3, currentColor); }
      .wdm-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, currentColor); }
      .wdm-warning { color: var(--dsw-alias-state-warn-primary, currentColor); }
      .wdm-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, currentColor); }
      .wdm-loading { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary, currentColor); }
    `

    /** Minimal observable that satisfies the slot machinery's HostObservable shape. */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (next) => {
          if (next === value) return
          value = next
          for (const listener of listeners) listener()
        },
      }
    }

    const keyOf = (provider, model) => provider + SEP + model
    const splitKey = (key) => {
      const at = key.indexOf(SEP)
      return at === -1 ? ['', ''] : [key.slice(0, at), key.slice(at + 1)]
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function findModel(catalog, provider, model) {
      for (const group of catalog.groups ?? []) {
        if (group.id !== provider) continue
        const found = (group.models ?? []).find(candidate => candidate.id === model)
        if (found !== undefined) return { group, model: found }
      }
      return undefined
    }

    function describeSelection(catalog, provider, model) {
      const hit = findModel(catalog, provider, model)
      return `${hit?.group.name ?? provider} · ${hit?.model.name ?? model}`
    }

    async function readState(ctx, workspaceId) {
      const [settingsResult, catalogResult] = await Promise.all([
        ctx.remote.settings.describe(),
        ctx.remote.session.modelCatalog(),
      ])
      if (!settingsResult.ok) throw new Error(settingsResult.error.message)
      if (!catalogResult.ok) throw new Error(catalogResult.error.message)
      const view = settingsResult.value.namespaces.find(candidate => candidate.ns === SETTINGS_NS)
      if (view === undefined) throw new Error('missing namespace')
      const defaults = Array.isArray(view.value?.workspaceDefaults)
        ? view.value.workspaceDefaults
        : []
      return {
        revision: view.revision,
        defaults,
        entry: defaults.find(candidate => candidate.workspaceId === workspaceId) ?? null,
        catalog: catalogResult.value,
      }
    }

    async function writeState(ctx, workspaceId, next, revision) {
      try {
        const result = await ctx.remote.settings.mutate(
          SETTINGS_NS,
          [{ op: 'set', path: ['workspaceDefaults'], value: next }],
          revision,
        )
        if (result.ok) return { ok: true }
        return {
          ok: false,
          conflict: result.error.code === 'SETTINGS_CONFLICT',
          message: result.error.message,
        }
      } catch (error) {
        return { ok: false, conflict: false, message: messageOf(error) }
      }
    }

    function Field(label, control) {
      return h('div', { className: 'wdm-field' }, h('span', { className: 'wdm-label' }, label), control)
    }

    function DialogForm({ request, load, save, close, t }) {
      const [attempt, setAttempt] = React.useState(0)
      const [state, setState] = React.useState({ phase: 'loading' })
      const [selection, setSelection] = React.useState('')
      const [effort, setEffort] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [failure, setFailure] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        setState({ phase: 'loading' })
        load(request.workspaceId).then((data) => {
          if (cancelled) return
          setState({ phase: 'ready', ...data })
          setSelection(data.entry === null ? '' : keyOf(data.entry.provider, data.entry.model))
          setEffort(data.entry?.reasoningEffort ?? '')
        }, (error) => {
          if (!cancelled) setState({ phase: 'failed', message: messageOf(error) })
        })
        return () => { cancelled = true }
      }, [request.workspaceId, load, attempt])

      const dismiss = () => { if (!saving) close() }

      const onSave = () => {
        if (saving || state.phase !== 'ready') return
        setSaving(true)
        setFailure(null)
        const chosen = selection === ''
          ? null
          : (() => {
            const [provider, model] = splitKey(selection)
            return { provider, model, ...(effort === '' ? {} : { reasoningEffort: effort }) }
          })()
        const next = state.defaults.filter(entry => entry.workspaceId !== request.workspaceId)
        if (chosen !== null) next.push({ workspaceId: request.workspaceId, ...chosen })
        save(request.workspaceId, next, state.revision).then((result) => {
          setSaving(false)
          if (result.ok) { close(); return }
          setFailure(result.conflict ? t('dialog.conflict') : t('dialog.saveFailed', { message: result.message }))
        }, (error) => {
          setSaving(false)
          setFailure(t('dialog.saveFailed', { message: messageOf(error) }))
        })
      }

      const footer = state.phase === 'ready'
        ? [
          h(Button, { key: 'cancel', variant: 'outline', disabled: saving, onClick: dismiss }, t('dialog.cancel')),
          h(Button, { key: 'save', variant: 'primary', disabled: saving, onClick: onSave },
            saving ? t('dialog.saving') : t('dialog.save')),
        ]
        : [h(Button, { key: 'cancel', variant: 'outline', disabled: saving, onClick: dismiss }, t('dialog.cancel'))]

      let body
      if (state.phase === 'loading') {
        body = h('p', { className: 'wdm-loading' }, t('dialog.loading'))
      } else if (state.phase === 'failed') {
        body = h(React.Fragment, null,
          h('p', { className: 'wdm-error', role: 'alert' }, t('dialog.loadFailed', { message: state.message })),
          h(Button, { variant: 'outline', onClick: () => setAttempt(value => value + 1) }, t('dialog.retry')),
        )
      } else {
        const catalog = state.catalog
        const empty = (catalog.groups ?? []).every(group => (group.models ?? []).length === 0)
        const chosen = selection === '' ? undefined : findModel(catalog, ...splitKey(selection))
        const efforts = chosen?.model.reasoning?.efforts ?? []
        const stale = state.entry !== null && findModel(catalog, state.entry.provider, state.entry.model) === undefined
        const globalDefault = describeSelection(catalog, catalog.default.provider, catalog.default.model)

        const modelSelect = h('select', {
          className: 'wdm-select',
          'aria-label': t('dialog.model'),
          'data-modal-autofocus': true,
          value: selection,
          disabled: saving || empty,
          onChange: (event) => {
            const value = event.target.value
            setSelection(value)
            if (value === '') { setEffort(''); return }
            const hit = findModel(catalog, ...splitKey(value))
            setEffort(hit?.model.reasoning?.defaultEffort ?? '')
          },
        },
        h('option', { value: '' }, t('dialog.follow', { model: globalDefault })),
        (catalog.groups ?? []).map(group => h('optgroup', { key: group.id, label: group.name },
          (group.models ?? []).map(model => h('option', { key: model.id, value: keyOf(group.id, model.id) },
            model.name + (model.badge === undefined ? '' : ` · ${model.badge}`))))))

        const effortSelect = efforts.length === 0 ? null : h('select', {
          className: 'wdm-select',
          'aria-label': t('dialog.effort'),
          value: effort,
          disabled: saving,
          onChange: (event) => setEffort(event.target.value),
        },
        h('option', { value: '' }, t('dialog.effortDefault')),
        efforts.map(item => h('option', { key: item.id, value: item.id }, item.name)))

        body = h(React.Fragment, null,
          empty ? h('p', { className: 'wdm-note' }, t('dialog.empty')) : null,
          empty ? null : Field(t('dialog.model'), modelSelect),
          effortSelect === null ? null : Field(t('dialog.effort'), effortSelect),
          stale ? h('p', { className: 'wdm-note wdm-warning' }, t('dialog.stale')) : null,
          failure === null ? null : h('p', { className: 'wdm-error', role: 'alert' }, failure))
      }

      return h(Modal, {
        open: true,
        title: t('dialog.title'),
        ...(state.phase === 'ready' ? { description: t('dialog.hint', { name: request.name }) } : {}),
        closeLabel: t('dialog.close'),
        onClose: dismiss,
        footer,
      }, h('div', { className: 'wdm-body' }, body))
    }

    function Dialog({ useRequest, ...rest }) {
      const request = useRequest(value => value)
      if (request === null) return null
      return h(DialogForm, { key: request.token, request, ...rest })
    }

    function apply(ctx) {
      const request = createStore(null)
      let sequence = 0

      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'workspace-model: dictionaries')
      const t = ctx.locale.bind(LOCALE_NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'workspace-model'
        style.textContent = css
        document.head.appendChild(style)
        return () => { style.remove() }
      }, 'workspace-model: styles')

      const open = (workspaceId, name) => {
        request.set({ workspaceId, name, token: ++sequence })
      }

      const load = async (workspaceId) => {
        try {
          return await readState(ctx, workspaceId)
        } catch (error) {
          if (messageOf(error) === 'missing namespace') throw new Error(t('dialog.missing'))
          throw error
        }
      }

      const save = async (workspaceId, next, revision) => {
        const result = await writeState(ctx, workspaceId, next, revision)
        if (result.ok) ctx.contextMenus.notify(t('dialog.saved'), true)
        return result
      }

      ctx.effect(() => ctx.contextMenus.register({
        id: 'workspace-model.open',
        target: 'workspace',
        order: 120,
        resolve: ({ workspaceId, displayTitle }) => [{
          id: 'open',
          label: t('menu.open'),
          icon: { key: 'workspace-model.open' },
          run: () => open(workspaceId, displayTitle),
        }],
      }), 'workspace-model: workspace menu')

      ctx.slots.inject('contextMenu.icon', function* () {
        yield ctx.slots.register({ name: 'contextMenu.icon', key: 'workspace-model.open' }, IconDataOutlineRegular)
      })

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'workspace-model.dialog',
        label: () => t('dialog.title'),
        locale: LOCALE_NS,
        inject: () => ({
          hooks: { request },
          load,
          save,
          close: () => { request.set(null) },
        }),
      }, Dialog))
    }

    const exports = { name: 'workspace-model', inject: ['slots', 'locale', 'contextMenus', 'remote', 'remote.session', 'remote.settings'], apply }
    return exports
  },
})
