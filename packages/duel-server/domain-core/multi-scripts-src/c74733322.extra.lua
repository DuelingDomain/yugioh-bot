-- Stock's anonymous turn-end callback replaces declared_names, discarding the
-- generated seat/team mapping. Initialize its global table here so that only
-- the generated mp_reset_all resets it, keeping the table and metatable alive.
local mp_stock_initial_effect=s.initial_effect
function s.initial_effect(c)
	if not s.global_check then
		s.global_check=true
		s.declared_names={[0]={},[1]={}}
	end
	mp_stock_initial_effect(c)
end
