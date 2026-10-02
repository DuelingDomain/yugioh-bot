if not aux.MPForEachDuelist then return end
-- Clown Crew Cappello: include each living duelist's face-up Extra Deck.
local function mp_all_pendulums()
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(p)
		g:Merge(Duel.GetMatchingGroup(aux.AND(Card.IsPendulumMonster,Card.IsFaceup,Card.IsAbleToDeck),p,LOCATION_MZONE|LOCATION_EXTRA,0,nil))
	end)
	return g
end
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk)
	local b1=not Duel.HasFlagEffect(tp,id) and #mp_all_pendulums()>0
	local b2=not Duel.HasFlagEffect(tp,id+1)
		and Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,nil,e,tp)
	if chk==0 then return b1 or b2 end
	local op=Duel.SelectEffect(tp,
		{b1,aux.Stringid(id,3)},
		{b2,aux.Stringid(id,4)})
	e:SetLabel(op)
	if op==1 then
		Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)
		e:SetCategory(CATEGORY_TODECK)
		local g=mp_all_pendulums()
		Duel.SetOperationInfo(0,CATEGORY_TODECK,g,#g,0,0)
	elseif op==2 then
		Duel.RegisterFlagEffect(tp,id+1,RESET_PHASE|PHASE_END,0,1)
		e:SetCategory(CATEGORY_SPECIAL_SUMMON)
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK|LOCATION_EXTRA)
	end
end
local mp_effop=s.effop
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	if e:GetLabel()~=1 then return mp_effop(e,tp,eg,ep,ev,re,r,rp) end
	local g=mp_all_pendulums()
	if #g>0 then Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT) end
end
