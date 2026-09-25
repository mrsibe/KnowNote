/**
 * Renderer-local workspace events.
 *
 * These are not global shortcuts: they never reach the main process and are not
 * configurable. They exist for a component to ask another, mounted component to
 * take focus when a panel closes — the one cross-panel request that is not about
 * *what* to show (that travels through `uiStore.focusedSource`) but about *where
 * the keyboard is*.
 */
export const FOCUS_CHAT_EVENT = 'workspace:focus-chat'
