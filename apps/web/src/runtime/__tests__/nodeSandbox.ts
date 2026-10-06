/// <reference types="node" />
import vm from 'node:vm'
import { LIMITS, Timeout, type Sandbox } from '../program'

/** The test twin of the browser's Worker: a fresh vm context per run, with the same time limits. */
export function nodeSandbox(): Sandbox {
  const context = vm.createContext({})
  const guard = <T,>(run: () => T): T => {
    try {
      return run()
    } catch (e) {
      // vm's timeout error may belong to another realm: match it by its code, not instanceof
      if ((e as { code?: unknown })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Timeout('timed out')
      throw e
    }
  }
  return {
    compile: (program) => guard(() => vm.runInContext(program, context, { timeout: LIMITS.loadMs })),
    call: (fn, args) => {
      context.__fn = fn
      context.__args = args
      return guard(() => vm.runInContext('__fn(...__args)', context, { timeout: LIMITS.loadMs }))
    },
  }
}
