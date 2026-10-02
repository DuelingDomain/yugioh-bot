if not aux.MPForEachDuelist then return end
-- Every duelist shuffles its hand, field and GY into its Deck and draws 5 (R1, Q3, Tag partner included). The group is built per duelist
-- (no unbound hand read); the Deck of every controller that got a card is shuffled (aux.MPForEachController).
local function mp_tdgroup(c)
	local loc=LOCATION_HAND|LOCATION_ONFIELD|LOCATION_GRAVE
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i)
		g:Merge(Duel.GetMatchingGroup(Card.IsAbleToDeck,tp_i,loc,0,nil,c))
	end)
	return g
end
function s.tdtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local g=mp_tdgroup(e:GetHandler())
	if chk==0 then return #g>0 and aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,5) end) end
	Duel.SetOperationInfo(0,CATEGORY_TODECK,g,1,0,0)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,5)
end
function s.tdop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetFlagEffect(tp,id)~=0 then return end
	Duel.RegisterFlagEffect(tp,id,0,0,0)
	local g=mp_tdgroup(e:GetHandler())
	if #g>0 and Duel.SendtoDeck(g,nil,SEQ_DECKTOP,REASON_EFFECT)>0 then
		local og=Duel.GetOperatedGroup()
		if not og:IsExists(Card.IsLocation,1,nil,LOCATION_DECK|LOCATION_EXTRA) then return end
		local dg=og:Filter(Card.IsLocation,nil,LOCATION_DECK)
		aux.MPForEachController(dg,function(sg,seat,p) Duel.ShuffleDeck(p) end)
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,5,REASON_EFFECT) end)
	end
end
