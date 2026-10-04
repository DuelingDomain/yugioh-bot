if not Duel.MPOwnerSeat or not aux.MPEachSeat then return end
-- Compare real seats. A folded owner value cannot identify a stolen card.
local function mp_material_target(seat)
 return function(e,c)
  local owner=Duel.MPOwnerSeat(c)
  return c:IsFaceup() and Duel.MPSeatOf(c)==seat and owner>=0
   and aux.MPKeyOfSeat(owner)~=aux.MPKeyOfSeat(seat)
 end
end
local mp_initial=s.initial_effect
function s.initial_effect(c)
 local register=Duel.RegisterEffect
 Duel.RegisterEffect=function(e,p)
  if e:GetCode()==EFFECT_ADD_SETCODE and e:GetValue()==SET_HECAHANDS then
   if p~=0 then return end
   aux.MPEachSeat(function(_,seat)
    local clone=seat==0 and e or e:Clone()
    clone:SetTarget(mp_material_target(seat))
    register(clone,seat)
   end)
  else register(e,p) end
 end
 mp_initial(c)
 Duel.RegisterEffect=register
end
-- Check the return branch without an opponent bind. SelectTarget declares the opponent
-- only if that branch is selected. The Fusion branch affects no opponent resources.
local function mp_return_filter(c,tp)
 return c:IsControler(1-tp) and c:IsSpellTrap() and c:IsAbleToHand()
end
local function mp_material_filter(c,e,tp)
 return c:IsOnField() and c:IsAbleToRemove(tp,POS_FACEUP,REASON_EFFECT)
end
function s.effcost(e,tp,eg,ep,ev,re,r,rp,chk)
	e:SetLabel(-100)
	local fusion_params={handler=e:GetHandler(),fusfilter=aux.FilterBoolFunction(Card.IsSetCard,SET_HECAHANDS),matfilter=mp_material_filter,extrafil=s.fextra,extraop=Fusion.BanishMaterial,extratg=s.extratg}
	local b1=not Duel.HasFlagEffect(tp,id)
		and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_HECAHANDS),tp,LOCATION_MZONE,0,1,nil)
		and Duel.IsExistingTarget(mp_return_filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil,tp)
	local b2=not Duel.HasFlagEffect(tp,id+1)
		and Fusion.SummonEffTG(fusion_params)(e,tp,eg,ep,ev,re,r,rp,0)
	if chk==0 then return b1 or b2 end
end
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return e:GetLabel()==1 and chkc:IsControler(1-tp) and chkc:IsOnField() and chkc:IsAbleToHand() end
	local cost_skip=e:GetLabel()~=-100
	local fusion_params={handler=e:GetHandler(),fusfilter=aux.FilterBoolFunction(Card.IsSetCard,SET_HECAHANDS),matfilter=mp_material_filter,extrafil=s.fextra,extraop=Fusion.BanishMaterial,extratg=s.extratg}
	local b1=(cost_skip or not Duel.HasFlagEffect(tp,id))
		and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_HECAHANDS),tp,LOCATION_MZONE,0,1,nil)
		and Duel.IsExistingTarget(mp_return_filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil,tp)
	local b2=(cost_skip or not Duel.HasFlagEffect(tp,id+1))
		and Fusion.SummonEffTG(fusion_params)(e,tp,eg,ep,ev,re,r,rp,0)
	if chk==0 then e:SetLabel(0) return b1 or b2 end
	local op=Duel.SelectEffect(tp,
		{b1,aux.Stringid(id,1)},
		{b2,aux.Stringid(id,2)})
	e:SetLabel(op)
	if op==1 then
		e:SetCategory(CATEGORY_TOHAND)
		e:SetProperty(EFFECT_FLAG_CARD_TARGET)
		Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_RTOHAND)
		local g=Duel.SelectTarget(tp,aux.AND(Card.IsSpellTrap,Card.IsAbleToHand),tp,0,LOCATION_ONFIELD,1,1,nil)
		if not cost_skip then Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1) end
		Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,1,tp,0)
	elseif op==2 then
		e:SetCategory(CATEGORY_REMOVE+CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)
		e:SetProperty(0)
		if not cost_skip then Duel.RegisterFlagEffect(tp,id+1,RESET_PHASE|PHASE_END,0,1) end
		Fusion.SummonEffTG(fusion_params)(e,tp,eg,ep,ev,re,r,rp,1)
	end
end
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	local op=e:GetLabel()
	if op==1 then
		--Return 1 Spell/Trap your opponent controls to the hand
		local tc=Duel.GetFirstTarget()
		if tc:IsRelateToEffect(e) then
			Duel.SendtoHand(tc,nil,REASON_EFFECT)
		end
	elseif op==2 then
		--Fusion Summon 1 "Hecahands" Fusion Monster from your Extra Deck, by banishing its materials from your field and/or GY
		local fusion_params={handler=e:GetHandler(),fusfilter=aux.FilterBoolFunction(Card.IsSetCard,SET_HECAHANDS),matfilter=mp_material_filter,extrafil=s.fextra,extraop=Fusion.BanishMaterial,extratg=s.extratg}
		Fusion.SummonEffOP(fusion_params)(e,tp,eg,ep,ev,re,r,rp)
	end
end