if not aux.MPForEachController then return end
-- Banished cards have their owner as controller. Bind each owner before legality and return checks.
function s.spfilter(c,e,tp)
	if c:GetFlagEffect(id)==0 then return false end
	local ok=false
	aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
		ok=Duel.GetLocationCount(p,LOCATION_MZONE)>0
			and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP,p)
	end)
	return ok
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	local rg=e:GetLabelObject()
	if #rg==0 then return end
	if Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT) then
		local g=rg:Filter(s.spfilter,nil,e,tp)
		if #g>0 then
			Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
			local sg=g:Select(tp,1,1,nil)
			aux.MPForEachController(sg,function(cards,seat,p)
				Duel.SpecialSummon(cards,0,tp,p,false,false,POS_FACEUP)
			end)
		end
	else
		aux.MPForEachController(rg,function(cards,seat,p)
			local ft=Duel.GetLocationCount(p,LOCATION_MZONE)
			local sg=cards:Filter(function(c)
				return c:GetFlagEffect(id)~=0 and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP,p)
			end,nil)
			if ft<=0 or #sg==0 then return end
			if #sg>ft then
				Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
				sg=sg:Select(tp,ft,ft,nil)
			end
			for c in aux.Next(sg) do Duel.SpecialSummonStep(c,0,tp,p,false,false,POS_FACEUP) end
		end)
		Duel.SpecialSummonComplete()
	end
	rg:Clear()
end
