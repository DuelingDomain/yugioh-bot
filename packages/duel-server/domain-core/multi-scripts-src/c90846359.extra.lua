-- stock: the summon limit reads Duel.GetMatchingGroup(Card.IsFaceup,targetp or sump,LOCATION_MZONE,0,nil). Both values are folded: 1 means
-- EVERY opponent of the owner of the Trap, and a read of a field with the value 1 gives the monsters of all those opponents together (a bound
-- opponent narrows only the hand, the Deck and the Extra Deck), so the limit of one opponent would read the monsters of the others too.
-- The limit reads the field of the duelist that summons: the real seat of the controller of the card (it goes to its own field). A Special Summon
-- to the field of another duelist (sump and targetp differ) keeps the stock read.
function s.sumlimit(e,c,sump,sumtype,sumpos,targetp)
	local seat=Duel.MPSeatOf(c)
	if seat<0 or sump~=targetp then
		local k=s.getrace(Duel.GetMatchingGroup(Card.IsFaceup,targetp or sump,LOCATION_MZONE,0,nil))
		return k~=0 and c:GetRace()~=k
	end
	local limited=false
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if seat_i~=seat then return false end
		local k=s.getrace(Duel.GetMatchingGroup(Card.IsFaceup,tp_i,LOCATION_MZONE,0,nil))
		limited=k~=0 and c:GetRace()~=k
		return true
	end)
	return limited
end
-- stock: the adjust handler keeps the race that the player 0 and the player 1 chose in s[0] and s[1]. Each living duelist keeps its own
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
			local rac=s.getrace(g)
			if (rac&rac-1)~=0 then
				if s[tp_i]==0 or (s[tp_i]&rac)==0 then
					Duel.Hint(HINT_SELECTMSG,tp_i,aux.Stringid(id,0))
					rac=Duel.AnnounceRace(tp_i,1,rac)
				else rac=s[tp_i] end
			end
			g:Remove(s.rmfilter,nil,rac)
			s[tp_i]=rac
		end
		if #g>0 then
			Duel.SendtoGrave(g,REASON_RULE,PLAYER_NONE,tp_i)
			readjust=true
		end
	end)
	if readjust then Duel.Readjust() end
end
