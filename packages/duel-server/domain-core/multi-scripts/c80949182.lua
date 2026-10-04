if not aux.MPKey then return end
-- Hama: every copy reads the battle damage of its opponents, not one flag of the first holder.
-- The global check gets real seats. Its table has one key per seat in FFA and one per team in Tag.
s.mp_battle_damage={}
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	s.mp_battle_damage[aux.MPKey(ep)]=true
end
function s.clear(e,tp,eg,ep,ev,re,r,rp)
	s.mp_battle_damage={}
end
-- A non-resource condition needs only one undamaged opponent in FFA.
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.MPTurnControls(e:GetHandler()) then return false end
	return aux.MPAnyOpponent(tp,function(tp_i,seat_i)
		return not s.mp_battle_damage[aux.MPKeyOfSeat(seat_i)]
	end)
end
local mp_damtg=s.damtg
local mp_ffa_damtg=aux.MPTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chk==0 then
		return aux.MPAny(function()
			return not s.mp_battle_damage[aux.MPKey(1-tp)]
				and mp_damtg(e,tp,eg,ep,ev,re,r,rp,0,chkc)
		end)()
	end
	return mp_damtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
end)
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if Duel.MPMode()==1 then return mp_ffa_damtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc) end
	return mp_damtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
end
