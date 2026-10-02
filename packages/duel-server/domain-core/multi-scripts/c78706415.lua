if not aux.MPForEachDuelist then return end
-- Every duelist shuffles its hand, field and GY into its Deck and draws 5 (R1, Q3, Tag partner included). The group is built per duelist
-- (no unbound hand read); the Deck of every controller that got a card is shuffled (aux.MPForEachController).
local function mp_alldeck()
	local loc=LOCATION_HAND|LOCATION_ONFIELD|LOCATION_GRAVE
	local g=Group.CreateGroup()
	aux.MPForEachDuelist(function(tp_i) g:Merge(Duel.GetFieldGroup(tp_i,loc,0)) end)
	return g
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local g=mp_alldeck()
	Duel.SetOperationInfo(0,CATEGORY_TODECK,g,#g,0,0)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local g=mp_alldeck()
	g:Remove(Card.IsStatus,nil,STATUS_BATTLE_DESTROYED)
	Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)
	local tg=Duel.GetOperatedGroup():Filter(Card.IsLocation,nil,LOCATION_DECK)
	aux.MPForEachController(tg,function(sg,seat,p) Duel.ShuffleDeck(p) end)
	Duel.BreakEffect()
	aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,5,REASON_EFFECT) end)
end
