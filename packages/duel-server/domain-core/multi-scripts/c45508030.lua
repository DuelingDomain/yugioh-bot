if not aux.MPForEachDuelist then return end
-- Issue #686: the stock filter passes the Duel.SpecialSummon arguments (e,0,tp,tp,false,false,pos) to Card.IsCanBeSpecialSummoned, whose
-- signature is (e,sumtype,sumplayer,nocheck,nolimit,sumpos,toplayer). The position mask lands in the "toplayer" slot. The stock core
-- ignores a toplayer above 1, but the multi-duelist core rejects it as a non-duelist, so no Charmer or Familiar-Possessed monster qualified
-- and the Spell was never offered. Same condition, correct arguments.
function s.spfilter(c,e,tp,att)
	return c:IsSetCard({SET_CHARMER,SET_FAMILIAR_POSSESSED}) and c:IsAttribute(att)
		and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_ATTACK|POS_FACEDOWN_DEFENSE)
end
