if not aux.MPForEachDuelist then return end
-- R-COMMON-EACH-PLAYER: count every living hand and field once, including the Tag partner.
local function mp_total(tp)
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetFieldGroup(p,LOCATION_ONFIELD|LOCATION_HAND,0))
	end)
	return #g
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		local ct=mp_total(tp)
		local g=Duel.GetMatchingGroup(s.rmfilter,tp,LOCATION_EXTRA,0,nil,tp)
		return aux.SelectUnselectGroup(g,e,tp,3,3,s.rmrescon(ct),0)
	end
	Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,3,tp,LOCATION_EXTRA)
	Duel.SetPossibleOperationInfo(0,CATEGORY_TOEXTRA,nil,2,tp,LOCATION_REMOVED)
	Duel.SetPossibleOperationInfo(0,CATEGORY_REMOVE,nil,1,1-tp,LOCATION_ONFIELD)
end
s.target=aux.MPAny(s.target)
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local ct=mp_total(tp)
	local exrmg=Duel.GetMatchingGroup(s.rmfilter,tp,LOCATION_EXTRA,0,nil,tp)
	if #exrmg<3 then return end
	local rg=aux.SelectUnselectGroup(exrmg,e,tp,3,3,s.rmrescon(ct),1,tp,HINTMSG_REMOVE)
	if not (#rg==3 and Duel.Remove(rg,POS_FACEUP,REASON_EFFECT)==3) then return end
	local opp_rg=Duel.GetMatchingGroup(Card.IsAbleToRemove,tp,0,LOCATION_ONFIELD,nil)
	if #opp_rg==0 then return end
	local rmtexg=Duel.GetMatchingGroup(s.texfilter,tp,LOCATION_REMOVED,0,nil)
	if not (#rmtexg>=2 and aux.SelectUnselectGroup(rmtexg,e,tp,2,2,s.texrescon,0) and Duel.SelectYesNo(tp,aux.Stringid(id,1))) then return end
	local texg=aux.SelectUnselectGroup(rmtexg,e,tp,2,2,s.texrescon,1,tp,HINTMSG_TODECK)
	if #texg~=2 then return end
	Duel.HintSelection(texg,true)
	Duel.BreakEffect()
	if Duel.SendtoDeck(texg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)==2 then 
		Duel.BreakEffect()
		Duel.Remove(opp_rg,POS_FACEUP,REASON_EFFECT)
	end
end
s.activate=aux.MPOne(s.activate)
