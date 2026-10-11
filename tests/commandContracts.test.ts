import Ajv2020 from 'ajv/dist/2020'
import { mapCommandResults } from '../src/commandResults'
import { expect, it } from 'vitest'
import { commandContracts } from './commandContracts'

it('publishes distinct typed input and output contracts for every background action', () => {
  expect(commandContracts).toHaveLength(9)
  expect(new Set(commandContracts.map(entry => entry.command.id)).size).toBe(commandContracts.length)
  for (const entry of commandContracts) expect(entry.output({ unexpected: 'not an owner result' }), entry.command.id).toBe(false)
})


it('publishes all 27 exact renderer result shapes without accepting unrelated payloads', () => {
  expect(Object.keys(mapCommandResults)).toHaveLength(27)
  const compiler = new Ajv2020({ strict: true })
  for (const [id, schema] of Object.entries(mapCommandResults)) {
    const validate = compiler.compile(schema)
    expect(validate({ unexpected: true }), id).toBe(false)
  }
  expect(compiler.compile(mapCommandResults['save-place'])({ id: 'p', name: 'P', lat: 0, lng: 0, createdAt: '', secret: 'bad' })).toBe(false)
  expect(compiler.compile(mapCommandResults['save-place'])({ id: 'p', name: 'P', lat: 0, lng: 0, createdAt: '' })).toBe(true)
  expect(compiler.compile(mapCommandResults['list-places'])([{ id: 'p', name: 'P', lat: 0, lng: 0, createdAt: '', category: null, color: null, note: null, position: 0 }])).toBe(true)
})
