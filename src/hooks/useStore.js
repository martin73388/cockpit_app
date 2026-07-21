import { useRef } from 'react'
import { useSyncExternalStore } from 'react'
import { store } from '../data/store.js'

const identity = (s) => s

// Subscribe a component to the store through a selector.
// The selected value is memoized per hook instance: while the store commit is
// unchanged we return the cached reference, and when it changes but the selected
// value is `isEqual` to the previous one we keep the old reference. This makes
// even a *deriving* selector (e.g. s => s.todos.filter(...)) safe — without it,
// a fresh array each call would trip useSyncExternalStore into an infinite loop.
export function useStore(selector = identity, isEqual = Object.is) {
  const ref = useRef(null)
  const getSnapshot = () => {
    const snap = store.getSnapshot()
    const c = ref.current
    if (c && c.snap === snap && c.sel === selector) return c.val
    const val = selector(snap)
    if (c && isEqual(c.val, val)) {
      ref.current = { snap, sel: selector, val: c.val }
      return c.val
    }
    ref.current = { snap, sel: selector, val }
    return val
  }
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}
