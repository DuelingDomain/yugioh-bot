/** Full page load. Used to restart a flow from a dead end, which also drops Clerk's in-memory attempt. Tests mock this module. */
export function hardNavigate(href: string): void {
  window.location.assign(href);
}
