export default function WatchUnavailable() {
  return <div role="alert">
    <h1>Admin watch unavailable</h1>
    <p>You cannot use admin watch while you are a player or invitee in this live duel or draft. Open the player view instead.</p>
    <p>The game may also have been removed, or your watch access may have ended.</p>
  </div>;
}
