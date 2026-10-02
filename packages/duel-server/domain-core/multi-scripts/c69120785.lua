-- The Bystial Alba Los: all Extra Decks include every living duelist, regardless of the event bind.
local function mp_all_extra()
 local g=Group.CreateGroup()
 aux.MPForEachDuelist(function(p)
  g:Merge(Duel.GetMatchingGroup(s.rmvfilter,p,LOCATION_EXTRA,0,nil))
 end)
 return g
end
function s.rmvtg(e,tp,eg,ep,ev,re,r,rp,chk)
 local g=mp_all_extra()
 if chk==0 then return #g>0 end
 Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,0,0)
end
function s.rmvop(e,tp,eg,ep,ev,re,r,rp)
	local g=mp_all_extra()
	if Duel.Remove(g,POS_FACEUP,REASON_EFFECT)>0 then
		local c=e:GetHandler()
		local fid=c:GetFieldID()
		local og=Duel.GetOperatedGroup()
		for oc in og:Iter() do
			oc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,2,fid)
		end
		og:KeepAlive()
		--Return the banished cards to the Extra Deck
		local e1=Effect.CreateEffect(c)
		e1:SetDescription(aux.Stringid(id,1))
		e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
		e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
		e1:SetCode(EVENT_PHASE+PHASE_END)
		e1:SetCountLimit(1)
		e1:SetLabel(fid)
		e1:SetLabelObject(og)
		e1:SetCondition(s.rcond)
		e1:SetOperation(s.roper)
		e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN)
		Duel.RegisterEffect(e1,tp)
	end
end
