if not aux.MPAny then return end
-- Boot Sector Launch: the Graveyard option asks if any one opponent controls more monsters. The operation takes the difference with the bound opponent.
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk)
	local mmz_chk=Duel.GetLocationCount(tp,LOCATION_MZONE)>0
	local b1=mmz_chk and Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_HAND,0,1,nil,e,tp)
	local b2=mmz_chk and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)()
		and Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)
	if chk==0 then return b1 or b2 end
	local op=Duel.SelectEffect(tp,
		{b1,aux.Stringid(id,1)},
		{b2,aux.Stringid(id,2)})
	e:SetLabel(op)
	local location=op==1 and LOCATION_HAND or LOCATION_GRAVE
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,location)
end
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	local ft=Duel.GetLocationCount(tp,LOCATION_MZONE)
	if ft<=0 then return end
	local op=e:GetLabel()
	local location=op==1 and LOCATION_HAND or LOCATION_GRAVE
	local g=Duel.GetMatchingGroup(s.spfilter,tp,location,0,nil,e,tp)
	if #g==0 then return end
		--Special Summon up to 2 "Rokket" monsters with different names from your hand in Defense Position
	local ct=(op==1 and 2)
		--Special Summon "Rokket" monsters with different names from your GY in Defense Position, up to the difference between the number of monsters you control and your opponent controls
		or (op==2 and aux.MPValue(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)-Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)())
		or 0
	ft=math.min(ft,#g,ct)
	if ft<=0 then return end
	if Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT) then ft=1 end
	local sg=aux.SelectUnselectGroup(g,e,tp,1,ft,aux.dncheck,1,tp,HINTMSG_SPSUMMON)
	if #sg>0 then
		Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP_DEFENSE)
	end
end
