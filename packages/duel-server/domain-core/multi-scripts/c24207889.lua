if not aux.MPKey then return end
-- There Can Be Only One: the adjust check loops over the players 0 and 1 and sends the cards of the two sides with the owner of the card
-- as player 0. The check is global and sees the real seats, so it loops over all four seats: each duelist keeps one monster of each
-- Race (the stock rule per side) and sends its own extra monsters to the GY. s.lastFieldId is a plain table by real seat.
function s.adjustop(e,tp,eg,ep,ev,re,r,rp)
	local phase=Duel.GetCurrentPhase()
	if (phase==PHASE_DAMAGE and not Duel.IsDamageCalculated()) or phase==PHASE_DAMAGE_CAL then return end
	if not Duel.IsExistingMatchingCard(faceupfil,0,LOCATION_SZONE,LOCATION_SZONE,1,nil) then
		for p=0,3 do s.lastFieldId[p]=nil end
		return
	end
	local sg=Group.CreateGroup()
	for p=0,3 do
		local g=Duel.GetMatchingGroup(Card.IsFaceup,p,LOCATION_MZONE,0,nil)
		if #g==0 then
			s.lastFieldId[p]=nil
		else
			local race=1
			local update_fid=false
			while (RACE_ALL&race)~=0 do
				local rg=g:Filter(Card.IsRace,nil,race)
				if s.lastFieldId[p] then
					local forced
					forced,rg=rg:Split(s.fidfilter,nil,s.lastFieldId[p])
					if #rg==0 then
						rg=forced
						update_fid=true
					else
						sg:Merge(forced)
					end
				end
				local rc=#rg
				if rc>1 then
					Duel.Hint(HINT_SELECTMSG,p,HINTMSG_TOGRAVE)
					sg:Merge(rg:Select(p,rc-1,rc-1,nil))
				end
				race=race<<1
			end
			if update_fid or not s.lastFieldId[p] then
				local maxg,maxid=g:Sub(sg):GetMaxGroup(Card.GetFieldID)
				s.lastFieldId[p]=maxid
			end
		end
	end
	local readjust=false
	for p=0,3 do
		local pg=sg:Filter(Card.IsControler,nil,p)
		if #pg>0 then
			Duel.SendtoGrave(pg,REASON_RULE,PLAYER_NONE,p)
			readjust=true
		end
	end
	if readjust then Duel.Readjust() end
end
