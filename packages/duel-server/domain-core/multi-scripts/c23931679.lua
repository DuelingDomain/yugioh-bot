if not aux.MPAny then return end
-- Ocean Dragon Lord - Kairyu-Shin: "each player can only control 1 face-up non-WATER monster" is every living duelist (R1).
-- The stock script keeps one flag for the opponent (id+1). Here each opposing duelist has the flag id+i (i = seat index in turn order), and each one chooses in a SEAT window.
local function side(c,who,g,flagid)
	local flag=c:HasFlagEffect(flagid)
	local ct=#g
	if ct==0 and flag then
		c:ResetFlagEffect(flagid)
	elseif ct>0 then
		if flag and ct>1 then
			g:Match(s.fidfilter,nil,c:GetFlagEffectLabel(flagid))
		elseif flag and ct==1 then
			g:Clear()
		elseif not flag then
			local tc=g:GetFirst()
			if ct>1 then
				Duel.Hint(HINT_SELECTMSG,who,aux.Stringid(id,1))
				tc=g:Select(who,1,1,nil):GetFirst()
				Duel.HintSelection(tc,true)
			end
			g:RemoveCard(tc)
			c:RegisterFlagEffect(flagid,RESET_EVENT|RESETS_STANDARD_DISABLE,0,1,tc:GetFieldID())
		end
	end
	return g
end
function s.adjustop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not s.umicon(e,tp,eg,ep,ev,re,r,rp) then
		for k=0,Duel.MPOppCount() do
			if c:HasFlagEffect(id+k) then c:ResetFlagEffect(id+k) end
		end
		return
	end
	local phase=Duel.GetCurrentPhase()
	if (phase==PHASE_DAMAGE and not Duel.IsDamageCalculated()) or phase==PHASE_DAMAGE_CAL then return end
	local readjust=false
	local g0=side(c,tp,Duel.GetMatchingGroup(s.nonwaterfilter,tp,LOCATION_MZONE,0,nil),id)
	if #g0>0 then
		Duel.SendtoGrave(g0,REASON_RULE,PLAYER_NONE,tp)
		readjust=true
	end
	aux.MPEachOpponent(function(i)
		local g=side(c,1-tp,Duel.GetMatchingGroup(s.nonwaterfilter,tp,0,LOCATION_MZONE,nil),id+i)
		if #g>0 then
			Duel.SendtoGrave(g,REASON_RULE,PLAYER_NONE,1-tp)
			readjust=true
		end
	end)()
	if readjust then Duel.Readjust() end
end
