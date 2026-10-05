if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.decltg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return true end
	local current_chain=Duel.GetCurrentChain()
	s.announce_filter={TYPE_NORMAL,OPCODE_ISTYPE,OPCODE_NOT}
	if current_chain>1 then
		for i=1,current_chain-1 do
			local trig_code1,trig_code2=Duel.GetChainInfo(i,CHAININFO_TRIGGERING_CODE,CHAININFO_TRIGGERING_CODE2)
			if trig_code1 then
				table.insert(s.announce_filter,trig_code1)
				table.insert(s.announce_filter,OPCODE_ISCODE)
				table.insert(s.announce_filter,OPCODE_NOT)
				table.insert(s.announce_filter,OPCODE_AND)
				if trig_code2>0 then
					table.insert(s.announce_filter,trig_code2)
					table.insert(s.announce_filter,OPCODE_ISCODE)
					table.insert(s.announce_filter,OPCODE_NOT)
					table.insert(s.announce_filter,OPCODE_AND)
				end
			end
		end
	end
	local declared_code=Duel.AnnounceCard(tp,s.announce_filter)
	Duel.SetTargetParam(declared_code)
	Duel.SetOperationInfo(0,CATEGORY_ANNOUNCE,nil,0,tp,ANNOUNCE_CARD_FILTER)
end
