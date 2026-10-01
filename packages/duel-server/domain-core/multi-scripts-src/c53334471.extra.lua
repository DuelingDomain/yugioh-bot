-- stock: the adjust handler keeps the attribute that the player 0 and the player 1 chose in s[0] and s[1]. Each living duelist keeps its own
-- choice (slot per seat in FFA, per team in Tag) and all duelists are checked, not only the two sides of the owner.
function s.acttg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	s.mp_reset_all()
end
function s.adjustop(e,tp,eg,ep,ev,re,r,rp)
	local phase=Duel.GetCurrentPhase()
	if (phase==PHASE_DAMAGE and not Duel.IsDamageCalculated()) or phase==PHASE_DAMAGE_CAL then return end
	local readjust=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		local g=Duel.GetMatchingGroup(Card.IsFaceup,tp_i,LOCATION_MZONE,0,nil)
		if #g==0 then
			s[tp_i]=0
		else
			local att=s.getattribute(g)
			if (att&att-1)~=0 then
				if s[tp_i]==0 or (s[tp_i]&att)==0 then
					Duel.Hint(HINT_SELECTMSG,tp_i,aux.Stringid(id,0))
					att=Duel.AnnounceAttribute(tp_i,1,att)
				else att=s[tp_i] end
			end
			g:Remove(s.rmfilter,nil,att)
			s[tp_i]=att
		end
		if #g>0 then
			Duel.SendtoGrave(g,REASON_RULE,PLAYER_NONE,tp_i)
			readjust=true
		end
	end)
	if readjust then Duel.Readjust() end
end
