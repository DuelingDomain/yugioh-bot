/** SQL policy shared by tournament lists, profile metadata and duel discovery. */
export function tournamentRelationshipScope(alias = "t", user = "@user"): string {
  return `${alias}.guild_id = @guild and (
    ${alias}.created_by_user_id = ${user}
    or ${alias}.id in (select tp.tournament_id from players p
      inner join tournament_participants tp on tp.player_id = p.id
      where p.guild_id = @guild and p.user_id = ${user})
    or exists (select 1 from tournament_invite_grants g where g.tournament_id = ${alias}.id and g.user_id = ${user})
  )`;
}

export function tournamentReadScope(alias = "t", user = "@user"): string {
  return `${alias}.guild_id = @guild and (${alias}.visibility = 'open' or (${tournamentRelationshipScope(alias, user)}))`;
}

/** A duel's own visibility never makes its source tournament discoverable. */
export function duelSeriesTournamentReadScope(
  seriesId: string,
  viewerUser = "(select viewer.user_id from players viewer where viewer.id = @viewer and viewer.guild_id = @guild)",
): string {
  return `not exists (
    select 1 from duel_series source
    join tournament_matches tm on tm.id = source.tournament_match_id
    where source.id = ${seriesId} and not exists (
      select 1 from tournaments t where t.id = tm.tournament_id and ${tournamentReadScope("t", viewerUser)}
    )
  )`;
}
