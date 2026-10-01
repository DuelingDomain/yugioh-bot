if not aux.MPAny then return end
-- Elemental HERO Thunder Giant - Voltic Thunder: the compare is in target chk==0 and asks if any one opponent controls more cards. The pool to destroy stays the whole field.
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
	local g=Duel.GetMatchingGroup(nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())
	if chk==0 then return #g>0 and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)>Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0) end)() end
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,tp,0)
end
