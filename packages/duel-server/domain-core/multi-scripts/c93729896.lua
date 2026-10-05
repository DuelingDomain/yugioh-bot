if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.regop(e,tp,eg,ep,ev,re,r,rp)
	local g=eg:Filter(s.thconfilter,nil,tp)
	if not Duel.IsChainSolving() then
		Duel.RaiseEvent(g,EVENT_CUSTOM+id,re,r,rp,tp,ev)
	else
		local label_obj=e:GetLabelObject()
		if label_obj then
			label_obj:Merge(g)
			local levels={e:GetLabel()}
			for tc in g:Iter() do
				table.insert(levels,tc:GetOriginalLevel())
			end
			e:SetLabel(table.unpack(levels))
		else
			e:SetLabel(table.unpack(g:GetClass(Card.GetOriginalLevel)))
			e:SetLabelObject(g)
			local c=e:GetHandler()
			--Raise the custom event at the end of the Chain
			local e1=Effect.CreateEffect(c)
			e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
			e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
			e1:SetCode(EVENT_CHAIN_SOLVED)
			e1:SetRange(LOCATION_FZONE)
			e1:SetCondition(function() return Duel.MPChainCount()==1 end)
			e1:SetOperation(function(eff)
						local g=e:GetLabelObject()
						eff:Reset()
						e:SetLabelObject(nil)
						if g then
							Duel.RaiseEvent(g,EVENT_CUSTOM+id,re,r,rp,tp,ev)
						end
					end)
			e1:SetReset(RESETS_STANDARD_PHASE_END)
			c:RegisterEffect(e1)
			local e2=e1:Clone()
			e2:SetCode(EVENT_CHAIN_NEGATED)
			c:RegisterEffect(e2)
		end
	end
end
