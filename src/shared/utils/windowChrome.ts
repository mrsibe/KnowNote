/**
 * Geometry of the custom title bar, shared by the main process (which asks the
 * OS to draw the window controls on top of the renderer) and the renderer
 * (which draws the bar underneath them).
 *
 * These two only line up if they agree on the same numbers, and they did not:
 * the overlay was 35px while the bar was 44px, so on Windows the
 * minimize/maximize/close buttons sat above the centre of the bar. Keeping the
 * height in one module is what stops that drift from coming back.
 */

/**
 * Height of the title bar, in CSS pixels.
 *
 * The renderer must keep the bar at this height — `TopNavigationBar` uses
 * `h-11`, which is 2.75rem = 44px with the default root font size. If one of
 * the two moves, move the other in the same commit.
 */
export const TITLE_BAR_HEIGHT = 44

/**
 * Horizontal space the OS-drawn window controls occupy, reserved by the
 * renderer so the tab strip and the settings button never slide underneath
 * them. Windows caption buttons are 3 x 46px at 100% scaling; Electron draws
 * its Linux controls at the same size.
 *
 * macOS is excluded: its traffic lights live on the left and the renderer
 * reserves their space separately.
 */
export const WINDOW_CONTROLS_WIDTH = 138

/**
 * Horizontal space macOS traffic lights occupy, reserved on the left.
 *
 * All four windows set `trafficLightPosition: { x: 16, y: 16 }`, so the three
 * buttons occupy roughly x=16..72. 80px leaves the standard macOS gap after
 * them; the main window already reserved exactly this and the three secondary
 * windows reserved 64px, which put their leftmost content under the green
 * button.
 */
export const MAC_TRAFFIC_LIGHTS_WIDTH = 80
