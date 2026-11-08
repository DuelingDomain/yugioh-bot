/**
 * Where the two calibration cards go, drawn from the player's seat: the Main Monster row is the row nearer the middle of the
 * table (M1 at the left), the Spell & Trap row is the row nearest the player (S5 at the right).
 */
export function ZoneRowDiagram({ className }: { className?: string }) {
  const cols = [0, 1, 2, 3, 4];
  const cell = (row: number, col: number, lit: string | null) => (
    <rect key={`${row}-${col}`} x={30 + col * 28} y={4 + row * 30} width="24" height="26" rx="3" fill={lit ? "var(--gold, #e8b94f)" : "none"} fillOpacity={lit ? 0.9 : 0} stroke="currentColor" strokeOpacity={lit ? 1 : 0.45} strokeWidth="1.2" />
  );
  return (
    <svg className={className} viewBox="0 0 180 84" role="img" aria-label="Seen from your seat: M1 is the far left card of the Main Monster row, the row nearer the middle of the table. S5 is the far right card of the Spell and Trap row, the row nearest you." width="180" height="84" style={{ display: "block", maxWidth: "100%", height: "auto", color: "var(--ink, #cdbfe8)" }}>
      {cols.map(c => cell(0, c, c === 0 ? "M1" : null))}
      {cols.map(c => cell(1, c, c === 4 ? "S5" : null))}
      <g fontFamily="system-ui, sans-serif" fontSize="9" fill="currentColor">
        <text x="2" y="21" fontWeight="700">Main</text><text x="2" y="30">Monster</text>
        <text x="2" y="51" fontWeight="700">Spell &amp;</text><text x="2" y="60">Trap</text>
        <text x="42" y="21" textAnchor="middle" fill="#1b1030" fontWeight="700">M1</text>
        <text x="154" y="51" textAnchor="middle" fill="#1b1030" fontWeight="700">S5</text>
        <text x="100" y="76" textAnchor="middle" fontWeight="700">▼ You sit at this edge</text>
      </g>
    </svg>
  );
}
