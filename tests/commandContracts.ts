import Ajv2020 from 'ajv/dist/2020'
import config from '../config.json'
import type { PluginCommandRegistration } from '@valley/plugin-sdk'

const services = config.runtime.services as unknown as Array<{ method: string; metadata?: { command?: PluginCommandRegistration; commands?: PluginCommandRegistration[] } }>
export const commandContracts = services.flatMap(service => (service.metadata?.commands ?? (service.metadata?.command ? [service.metadata.command] : [])).map(command => {
  if (!command.inputSchema || !command.outputSchema) throw new Error(`Command ${command.id} must declare input and output schemas`)
  const compiler = new Ajv2020({ strict: false, strictSchema: true, validateFormats: false, ownProperties: true })
  return { method: service.method, command, input: compiler.compile(command.inputSchema), output: compiler.compile(command.outputSchema) }
}))

export function assertCommandOutput(method: string, input: unknown, result: unknown): unknown {
  const payload = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const contract = commandContracts.find(entry => (entry.method === method || entry.command.id === method) && (!entry.command.request || Object.entries(entry.command.request.constants).every(([key, value]) => key === 'items' || JSON.stringify(payload[key]) === JSON.stringify(value))))
  if (!contract) return result
  let output = result
  if (contract.command.result === 'driver') {
    if (!result || typeof result !== 'object' || !('ok' in result) || !result.ok) return result
    output = 'data' in result ? result.data : null
  } else if (contract.command.result === 'command') output = result && typeof result === 'object' && 'value' in result ? result.value : undefined
  if (!contract.output(output ?? null)) throw new Error(`Invalid ${contract.command.id} output: ${JSON.stringify(contract.output.errors)}`)
  return result
}
