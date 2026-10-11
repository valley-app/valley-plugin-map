import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import { expect, it, vi } from 'vitest'
vi.mock('../src/mapEngine', () => ({ MapEngine: vi.fn() }))
import { createMockValleyApi } from '@valley/plugin-testkit'
import type { ValleyPluginApi } from '@valley/plugin-sdk'
import { createStore, disposeStore } from '../src/store'
import { initRuntime } from '../src/runtime'
import { initLocalization } from '../src/localization'
import { registerMapboxCommands } from '../src/commands'
import { registerMapAutomation } from '../src/automation'
import { registerMapSurfaces } from '../src/surfaces'
import { registerMapFileCommands } from '../src/fileCommands'
import { commandContracts } from './commandContracts'

const options = { strict: false, strictSchema: true, allErrors: true, validateFormats: false, allowUnionTypes: true, ownProperties: true }

function compileLikeValley(schema: Record<string, unknown>): void {
  const draft07 = typeof schema.$schema === 'string' && schema.$schema.includes('draft-07')
  const validator = draft07 ? new Ajv(options) : new Ajv2020(options)
  validator.validateSchema(schema, true)
  const compiler = draft07 ? new Ajv({ ...options, validateSchema: false }) : new Ajv2020({ ...options, validateSchema: false })
  compiler.compile(structuredClone(schema))
}

it('compiles every Map command input and output schema the way Valley main does', async () => {
  const { api } = createMockValleyApi({ manifest: { id: 'map' }, overrides: { backend: { call: async () => ({ ok: false }), callOperation: async () => ({ ok: false }), on: () => () => {} } as unknown as ValleyPluginApi['backend'] } })
  const store = createStore(api)
  initRuntime(api)
  initLocalization(api)
  const registrations = vi.spyOn(api.commands, 'register')
  registerMapboxCommands(api)
  registerMapAutomation(api)
  registerMapSurfaces(api)
  registerMapFileCommands(api)
  await store.ready
  const schemas = registrations.mock.calls.flatMap(([command]) => [[`${command.id} input`, command.input?.schema], [`${command.id} output`, command.outputSchema]] as const)
    .concat(commandContracts.flatMap(({ command }) => [[`${command.id} input`, command.inputSchema], [`${command.id} output`, command.outputSchema]] as const))
  expect(registrations.mock.calls.map(([command]) => command.id)).toEqual(expect.arrayContaining(['import-route', 'save-route', 'show-route', 'export-route', 'list-routes', 'delete-route']))
  const failures = schemas.filter(([, schema]) => schema).flatMap(([label, schema]) => {
    try { compileLikeValley(schema as Record<string, unknown>); return [] } catch (error) { return [`${label}: ${(error as Error).message}`] }
  })
  disposeStore(store)
  expect(failures).toEqual([])
})
