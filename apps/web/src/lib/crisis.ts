/**
 * Deterministic crisis check, in two tiers (07 D43). Never routed through a model on its own.
 * A regex layer, not a complete safety system: a trained person must review this file before launch (07 D4),
 * and the independent evals dataset is a P7 gate. The server is the gate; the browser copy is best effort.
 *
 * - Tier 1 ("certain"): precise patterns. A hit shows the crisis card at once. `isCrisis` means tier 1.
 * - Tier 2 ("check"): a broad word list. It never shows the card by itself. It tells the harness that a cheap
 *   classification-only model call must decide, and the harness shows the card on "yes" or when the call fails.
 *   Tier 2 is allowed to be noisy.
 *
 * Bias: when unsure, show the card or ask the model. Known false positives are pinned in tests/unit/crisis.test.ts.
 *
 * Rules run on `matchForm(...).punct` (07 D1), which is built from the exact text a model would see, so a phrase
 * cannot slip past behind tags, invisible characters, combining marks or lookalike letters. Words in a rule may be
 * separated by spacing, a newline, "..." or one sentence break, and by up to two filler words ("I just want to,
 * like, die"). A letters-only copy catches spaced-out or run-together spellings, but only when the hit starts and
 * ends on word edges (so "upskill myself" does not match "kill myself").
 *
 * Deviations from 07 D3, each with a reason:
 *  - "no/not/without" ignores a hit only for the medical-emergency rules, and only when the negation sits directly
 *    before the phrase with no comma or sentence break between ("no chest pain right now" is ignored, "No, I think
 *    I'm having a heart attack" is not). Self-harm and abuse rules have no negation guard.
 *  - `end everything`, `end it`, `hurt myself` and `cut myself` carry small exceptions so that "end everything on my
 *    list", "end it with my boyfriend", "I hurt myself lifting a box" and "I cut myself shaving" do not trigger.
 *
 * This file is imported by the browser: no lookbehind, no server modules (tests/unit/clientSafe.test.ts).
 */
import { matchForm, squashHitOk, type MatchForm } from "@/lib/ai/guards/input";

export type CrisisTier = "certain" | "check" | "none";

interface Hit {
  /** Words of the same sentence before the match (commas removed). */
  before: string;
  /** The same with commas kept, for the negation check. */
  beforeRaw: string;
  /** Words of the same sentence after the match. */
  after: string;
}

interface Rule {
  re: RegExp;
  squashed?: RegExp;
  negatable: boolean;
  veto?: (hit: Hit) => boolean;
}

interface RuleOptions {
  /** false: no letters-only form. A string: a custom letters-only pattern. Default: the pattern with spaces removed. */
  squash?: boolean | string;
  negatable?: boolean;
  veto?: (hit: Hit) => boolean;
}

const FILLER =
  "(?:like|just|you know|really|honestly|so|literally|actually|kind of|sort of|maybe|totally|simply|fucking|freaking)";
const BREAK = String.raw`(?:[.,]\s+)?`;
/** Between two words of a rule: spacing, an optional comma or sentence break, and up to two filler words. */
const SEP = String.raw`\s+${BREAK}(?:${FILLER}\s+${BREAK}){0,2}`;

/** Words are separated by a single space in `src`; a space becomes SEP in the spaced form and disappears in the squashed form. */
function rule(src: string, o: RuleOptions = {}): Rule {
  const re = new RegExp(String.raw`\b(?:${src.replace(/ /g, SEP)})\b`, "g");
  const squashSrc = typeof o.squash === "string" ? o.squash : o.squash === false ? undefined : src.replace(/ /g, "").split("\\w*").join("").split("\\w+").join("[a-z]+");
  return { re, squashed: squashSrc ? new RegExp(squashSrc, "g") : undefined, negatable: o.negatable ?? false, veto: o.veto };
}

const INTENT_WORDS =
  "want(?:ed|s)? to|wanna|going to|gonna|need to|plan(?:ning)? to|trying to|tried to|keep|keeps|kept|urge to|about to|thinking (?:about|of)|thought about|feel like|ready to|decided to|will|would|might|could|have to|used to|started|start to|so i can|in order to";
const INTENT_BEFORE = new RegExp(String.raw`(?:${INTENT_WORDS})(?:\s+(?:just|really|actually|again|also|sometimes|often|always|i|and))*\s*$`);
const ACCIDENT = /\b(?:shaving|shave|cooking|chopping|slicing|paper|vegetables|opening|kitchen|glass|door|accident\w*|by mistake|fell|fall|falling|tripped|slipped|lifting|carrying|moving|playing|exercising|working|running|walking|skiing|gym|workout|yesterday|ago|last|while|when|today|this morning|stubbed|knife)\b/;
const ACCIDENT_STRICT = /\b(?:shaving|shave|cooking|chopping|slicing|paper|vegetables|opening|kitchen|glass|door|accident\w*|by mistake|fell|tripped|slipped|stubbed|gardening|while)\b/;
const PURPOSE = /\b(?:again|on purpose|deliberately|to hurt|to feel|to cope|to punish|to relieve|every day|every night|every week|scars?)\b/;
const WEAK_PURPOSE = /\b(?:before|bleeding|liked it|felt good|felt better|razor blade|with a blade|in the bathroom)\b/;

const lastWords = (s: string, n: number): string => s.split(" ").slice(-n).join(" ");
const firstWords = (s: string, n: number): string => s.split(" ").slice(0, n).join(" ");

/** Hurt or burn myself: crisis unless it reads like an accident ("I hurt myself lifting a box"). */
const hurtVeto = (h: Hit): boolean => {
  if (INTENT_BEFORE.test(h.before) || PURPOSE.test(firstWords(h.after, 6))) return false;
  return ACCIDENT.test(`${lastWords(h.before, 4)} ${firstWords(h.after, 6)}`);
};

/** Cut my arms or legs: crisis unless an everyday cause is named ("I cut my arm on the glass"). "last night" does not hide it. */
const bodyCutVeto = (h: Hit): boolean => {
  const near = firstWords(h.after, 8);
  if (PURPOSE.test(near) || INTENT_BEFORE.test(h.before)) return false;
  return ACCIDENT_STRICT.test(`${lastWords(h.before, 3)} ${near}`);
};

/** Cut myself: crisis with a stated purpose, a repeat, intent, or non-accidental bleeding. A bare "I cut myself" is not. */
const cutVeto = (h: Hit): boolean => {
  const near = firstWords(h.after, 8);
  if (PURPOSE.test(near) || INTENT_BEFORE.test(h.before)) return false;
  if (ACCIDENT_STRICT.test(`${lastWords(h.before, 3)} ${near}`)) return true;
  return !WEAK_PURPOSE.test(near);
};

/** "end everything" is crisis only when nothing about a list or task follows. */
const endEverythingVeto = (h: Hit): boolean => !/^(?:now|tonight|today|soon|tomorrow|forever|for good|right now|please|already|here)?$/.test(h.after);

const endItVeto = (h: Hit): boolean => /^(?:with|between|before|after|when|if|because|for|here|there|early|this|the)\b/.test(h.after);

/** "I have been cutting" alone is self-harm. "cutting vegetables", "cutting back", "cutting my hair" are not. */
const cuttingBareVeto = (h: Hit): boolean => !/^(?:again|a lot|more|lately|deeper|every day|every night)?$/.test(h.after);

/** Idioms such as "my boss will kill me if I am late". */
const killMeVeto = (h: Hit): boolean => /^(?:if|when|because|unless|for|with|laughing|trying)\b/.test(h.after);

const dyingVeto = (h: Hit): boolean => /^(?:to|of|for|laughing|inside|from|without|here)\b/.test(h.after);

const breatheVeto = (h: Hit): boolean =>
  /^(?:through|out of|well|at night|when|while|during|if|after|before|once|whenever|lying|laying|every|since|because|in the|in my sleep|on stairs|with|much|easily|deeply|fully|enough)\b/.test(h.after);

const catchBreathVeto = (h: Hit): boolean => /^(?:when|after|while|if|since|because|during)\b/.test(h.after);

/** "I want to jump" is crisis; "I want to jump into the pool" and "jump to conclusions" are not. */
const jumpVeto = (h: Hit): boolean => /^(?:rope|up|into|in the|on|around|start|ahead|to conclusions|at|for|the queue|the line|through|back|over)\b/.test(h.after);

/** Chest pain that comes with exercise or has gone on for months is not an emergency card. */
const chronicVeto = (h: Hit): boolean => /^(?:when|since|for|on and off|every|after|during|sometimes|whenever|at night)\b/.test(h.after);

const dyeVeto = (h: Hit): boolean => h.after !== "";

/** Idioms after "I want to die": "laughing", "of embarrassment", "on that hill". */
const dieIdiomVeto = (h: Hit): boolean =>
  /^(?:laughing|of (?:embarrassment|laughter|boredom|shame)|on (?:that|this|a|the) hill|from (?:embarrassment|laughter)|to (?:see|know|find)|if i (?:miss|forget|have))\b/.test(h.after);

/** "I don't feel safe driving at night" is about an activity; "I don't feel safe at home" is not. */
const safeActivityVeto = (h: Hit): boolean =>
  /^(?:driving|walking|going|crossing|taking|using|riding|flying|swimming|running|cycling|biking|on|about|when|with|around the|to)\b/.test(h.after);

/** Talk about suicide as a topic ("prevention volunteer", "a topic for class") is not a person in crisis. */
const suicideTopicVeto = (h: Hit): boolean =>
  /\b(?:prevention|awareness|hotline|volunteer|class|course|essay|study|studying|documentary|statistics|training|research|topic|lecture|book|article|movie|podcast)\b/.test(`${h.before} ${h.after}`);

const NEGATION = /(?:^|\s)(?:no|not|dont|doesnt|didnt|havent|hasnt|never|without|deny|denies|denied|denying|nor)(?:\s+(?:have|having|had|got|get|feel|feeling|felt|any|a|an|the|currently|really|experiencing|experience|or|and|even|such))*\s*$/;

const PEOPLE =
  "(?:he|she|they|someone|somebody|my (?:boyfriend|girlfriend|partner|husband|wife|ex|dad|mom|mum|mother|father|brother|sister|uncle|aunt|stepdad|stepmom|stepfather|stepmother|roommate|caregiver|carer|boss|teacher|coach|son|daughter|parent|parents|grandfather|grandmother|grandpa|grandma|cousin|neighbor|landlord))";
const AUX = "(?:(?:is|are|keeps|keep|has been|have been|was|started|just|always|sometimes|often|also|will|would|gonna|going to|wants to|threatened to|threatens to) )*";
const PRE_VERB = "(?:(?:shouts|yells|screams|swears)(?: at me)? and )?";
const SELF = "(?:myself|my self|himself|herself|themselves|themself)";

const RULES: readonly Rule[] = [
  // ---- suicide and self-harm, English
  rule(`(?:kill|killing|killed|kil|off|offing|hang|hanging|hung|shoot|shooting|stab|stabbing|poison|poisoning|drown|drowning|suffocate|suffocating|strangle|strangling|starve|starving|electrocute|electrocuting|asphyxiate) ${SELF}`),
  rule(`(?:hurt|hurting|harm|harming|injure|injuring|burn|burning|burned|burnt|punish|punishing|hit|hitting|bite|biting|bit|scratch|scratching|scratched) ${SELF}`, { veto: hurtVeto }),
  rule("(?:cut|slit|slash|carve|carved) (?:myself|my self)", { veto: cutVeto }),
  rule("(?:cut|cutting|slit|slitting|slash|slashing|carve|carved|carving) my (?:arms?|legs?|thighs?|stomach|skin|body|chest|hips?|ankles?|forearms?|belly)", { veto: bodyCutVeto }),
  rule("(?:cutting|slitting|slashing) (?:myself|my self)", { veto: hurtVeto }),
  rule("(?:ive been|i have been|ive started|i started|i keep|keep|im|i am) cutting", { veto: cuttingBareVeto }),
  rule("(?:cut|cutting|slit|slitting|slash|slashing) (?:my wrists?|my throat)"),
  rule("(?:put|stub|stubbed|stubbing|burn|burned|burning) (?:out )?(?:cigarettes?|a cigarette|a lighter|matches) (?:out )?on my (?:arms?|legs?|skin|hands?|wrists?)"),
  rule("(?:hit|bang|banged|banging|slam|slammed|slamming|bash|bashed|scratch|scratched|burn|burned|bite|bit) my (?:head|arms?|hands?|legs?|skin|wrists?|thighs?)(?: \\w+){0,5}? (?:on purpose|deliberately)"),
  rule("kill me", { veto: killMeVeto }),
  rule("(?:want(?:ed|s)? to|wnat to|wanna|wana|going to|gonna|about to|ready to|plan(?:ning)? to|decided to|need to|tried to|trying to|have to|hoping to|thinking (?:about|of)|thought about|hope to|wish to|rather) (?:just |finally |really |actually |simply )?(?:die|dying|be dead|not be alive|not exist|not be here|stop existing|disappear|dissapear|disapear|stop living|not wake up|never wake up|go to sleep and not wake up|go to sleep and never wake up)", { veto: dieIdiomVeto }),
  rule("(?:(?:want|wnat) to|wanna) dye", { veto: dyeVeto }),
  rule("(?:id|i would|i had) rather (?:be dead|die|not be alive|not be here)"),
  rule("(?:feel|feels|feeling) like (?:dying|dead|killing myself|ending it|ending my life)"),
  rule("so (?:i|that i) (?:can|could|will) (?:die|be dead)"),
  rule("should (?:just )?(?:die|be dead|end it all|end my life|kill myself)|ought to (?:be dead|die)"),
  rule("(?:wish|hope) (?:i|id|that i|that id) (?:was|were|am) (?:dead|not here|not alive|never born)"),
  rule("(?:wish|hope) (?:i|id|that i|that id) (?:wasnt|werent|was not|were not) (?:alive|here|born|around)"),
  rule("(?:wish|hope) (?:i|id|that i|that id) (?:could|would|can|might|will) (?:just )?(?:die|disappear|be dead|not wake up|never wake up|go to sleep and not wake up|go to sleep and never wake up|end it|stop existing|stop living|not exist|never exist|not be here)"),
  rule("(?:wish|hope) (?:i|id|that i|that id)(?: had)? (?:never|hadnt|didnt|dont|wont) (?:been born|born|woke up|woken up|wake up|existed|exist)"),
  rule("(?:wish|hope) (?:i|id|that i|that id) (?:could|would) (?:just )?(?:never|not) (?:wake up|exist|be born)"),
  rule("(?:hope|wish) (?:i )?(?:get|got|would get)? ?(?:hit|run over|killed) by (?:a )?(?:bus|car|truck|train|lorry)|(?:hope|wish) (?:a|the) (?:bus|car|truck|train|lorry) (?:would |will )?(?:hit|run over|kill) me"),
  rule("(?:better|happier|safer|easier) (?:off )?(?:dead|without me|if i (?:was|were|wasnt|werent) (?:gone|dead|here|around|alive|born)|if i (?:died|disappeared|vanished|didnt exist|never existed))|better to be dead|better dead"),
  rule("(?:dying|death) would be (?:a |such a )?relief|(?:no one|nobody|noone) (?:would|will) (?:miss me|care if i|notice if i|care if im|notice if im)"),
  rule("(?:i )?think(?:ing)? about (?:dying|death|suicide|killing myself|ending it)|(?:keep|keeps) thinking about (?:dying|death|suicide|killing myself)"),
  rule("(?:dont|do not|didnt|did not|no longer|never) (?:wanna|want to|want) (?:be here|live|be alive|exist|go on|be around|keep going|wake up tomorrow|wake up again)"),
  rule("(?:dont|do not) deserve (?:to live|to be alive|to exist|to be here|to be around)|(?:shouldnt|should not) (?:even )?(?:be alive|exist|be here|be around)"),
  rule("(?:cant|cannot|can not) (?:go on|keep going|take it anymore|take this anymore|do this anymore|do this any more|keep living|live like this|go on living)"),
  rule("(?:want|wish|need) (?:it all|everything|all of it) to (?:end|stop|be over|go away)"),
  rule("(?:want|wanna|wish|need) (?:out of|to be out of) (?:this|my) life|make (?:the|my) pain stop (?:forever|permanently|for good)|end (?:the|my) (?:pain|suffering|misery) (?:forever|for good|permanently)"),
  rule("(?:no (?:reason|point|purpose) (?:to|in) (?:live|living|go on|going on|be alive|being alive)|(?:dont|do not|cant|cannot) see (?:a |the |any )?(?:point|reason) (?:in|to|of) (?:living|going on|life|being alive|continuing|staying alive|it all)|nothing to live for|not worth living|life (?:is|isnt|was|wasnt) (?:not )?worth (?:living|it)|no point (?:in )?(?:living|going on|being alive)|the point of (?:living|going on|being alive)|point of life)"),
  rule("(?:im|i am) (?:so |really |just )?done (?:with|living) (?:life|living)|(?:tired|sick|exhausted) of (?:living|being alive|life)|give up on life|giving up on life|gave up on life|give up on living"),
  rule("end(?:ing|ed)? (?:it all|my life|my own life|my suffering|his life|her life|their life|his own life|her own life)"),
  rule("end(?:ing)? everything", { veto: endEverythingVeto }),
  rule("(?:want(?:ed|s)? to|wanna|going to|gonna|ready to|need to|planning to|plan to|decided to|about to|trying to|thinking (?:about|of)) end(?:ing)? it", { veto: endItVeto }),
  rule("end it (?:now|tonight|today|soon|forever|for good)"),
  rule("(?:take|taking|took|taken|end|ending|ended) my (?:own )?life"),
  rule("suicid\\w*", { negatable: true, veto: suicideTopicVeto }),
  rule("relaps\\w* (?:on |into |to )?(?:cutting|self harm|selfharm|burning|hurting myself)"),
  rule("kms"),
  rule("unaliv\\w*"),
  rule("(?:selfharm|self harm|selfinjur\\w*|self injur\\w*|selfmutilat\\w*|self mutilat\\w*)\\w*"),
  rule("(?:want(?:ed)? to|wanna|going to|gonna|about to|ready to|thinking (?:of|about)) jump(?:ing)?(?: (?:off|from|out of|down))?", { veto: jumpVeto }),
  rule("jump(?:ing|ed)? (?:off|from|out of) (?:a |the |my )?(?:bridge|building|roof|balcony|cliff|window|overpass|tower)"),
  rule("(?:jump|jumping|step|stepping) (?:out )?in front of (?:a |the )?(?:train|bus|car|truck|traffic|subway)"),
  rule("(?:i|im|ive) (?:(?:just|probably|maybe|accidentally|actually|definitely|really|think|might|may|will|could|would|have|had|am|already|almost|nearly|want to|wanna|gonna|going to|about to|need to|thinking of|thinking about|planning to|trying to|tried to|ready to|decided to|dont know if|not sure if|believe i) )*(?:overdose|overdosed|overdosing)"),
  rule("(?:is|are|was) overdosing|just overdosed|overdosing right now|overdosed right now"),
  rule("(?:took|taken|swallowed) (?:way )?too many (?:pills|tablets|meds|medications|medicine|painkillers|capsules)"),
  rule("(?:took|swallowed|swallowing) (?:a |the )?(?:whole|entire) bottle of"),
  rule("(?:took|swallowed|swallowing) (?:a bunch of|a handful of|a whole bunch of|all of my|all my) (?:my |the )?(?:pills|tablets|meds|medication|medicine)"),
  rule("(?:took|take|taken|swallowed|drank|drink|ate)(?: \\w+){0,6}? (?:on purpose|deliberately)"),
  rule("(?:took|swallowed) (?:my|the) (?:whole|entire) (?:prescription|bottle|pack)"),
  rule("(?:going to|gonna|will|want to|wanna|about to) (?:take|swallow|down) (?:all|every one|every single|a whole|the whole|a bunch|a handful)(?: of)?(?: my| the)? (?:pills|tablets|meds|medication|medicine)"),
  rule("(?:drank|drink|drinking|swallowed|swallow|swallowing|ate|inhaled|injected) (?:some )?(?:bleach|poison|antifreeze|rat poison|drain cleaner|lye|pesticide|weed ?killer|cleaning fluid)"),
  rule("(?:wrote|writing|write|left|leaving|leave) (?:a |my |the )?(?:goodbye|suicide|good bye|final) (?:note|letter|message)|this is my last (?:message|note|goodbye|post)|saying goodbye to (?:everyone|everybody|all of you)"),
  rule("(?:rope|noose|pills|gun|razor|blade|knife) (?:is |are )?ready|(?:have|got|bought|buy|buying) (?:a |the |my |some )?(?:rope|noose|gun|razor|blade)s? (?:to|so i can|for) (?:shoot|hang|kill|end|cut|die)"),
  rule("how many (?:\\w+ ){0,2}?(?:to|will|would|does it take to) (?:die|overdose|kill me|be fatal|be lethal)|lethal dose|painless (?:way|to) (?:die|hang|kill|end)|(?:best|easiest|painless|quickest|fastest) (?:way|method)s? to (?:die|kill myself|commit suicide|end it|end my life)|how to (?:commit suicide|hang myself|kill myself|end my life)"),
  rule("(?:hope|wish) i (?:dont|never|wont) wake up|go to sleep and never wake up|dont want to wake up (?:tomorrow|again|ever)"),

  // ---- danger from another person, English
  rule(`${PEOPLE} ${AUX}${PRE_VERB}(?:hit|hits|hitting|beat|beats|beating|abuse|abuses|abusing|abused|threaten|threatened|threatens|threatening|choke|choked|chokes|choking|strangle|strangled|strangles|strangling|rape|raped|rapes|raping|assault|assaulted|assaults|assaulting|slap|slapped|slaps|slapping|punch|punched|punches|punching|kick|kicked|kicks|kicking|shove|shoved|shoves|push|pushed|pushes|grab|grabbed|grabs|molest\\w*|stalk\\w*|harass\\w*|attack\\w*|hurt|hurts|hurting) me`),
  rule(`${PEOPLE} (?:locks|locked|lock|keeps|kept) me (?:in|inside|locked)`),
  rule(`${PEOPLE} (?:wont|will not|doesnt|dont|refuses to|wouldnt|not) (?:let|allow) me (?:eat|sleep|leave|go out|see|call|have food)|${PEOPLE} (?:starves|starving|starved) me`),
  rule("(?:will|going to|gonna|would|threatens to|threatened to) (?:hurt|hit|beat|harm|rape|choke) me"),
  rule("(?:touch|touches|touched|touching|molested|fondled) me (?:where|in a|inappropriately|sexually|in places)"),
  rule("(?:being|been|im|i am|ive been|i was|i have been) (?:physically |sexually |emotionally )?(?:abused|beaten|raped|assaulted|molested|stalked|trafficked|threatened|choked|strangled)"),
  rule("being (?:physically |sexually |emotionally )?(?:hurt|hit|harmed|mistreated|locked up|controlled|forced)"),
  rule("(?:scared|afraid|terrified|frightened) (?:of|for my life) (?:my )?(?:partner|husband|wife|boyfriend|girlfriend|dad|father|mom|mother|brother|sister|uncle|stepdad|caregiver|boss|ex|him|her|them)"),
  rule("(?:scared|afraid|terrified|frightened) to (?:go|be|stay|get) (?:home|there|alone with)"),
  rule("(?:dont|do not|no longer|never) feel safe", { veto: safeActivityVeto }),
  rule("(?:im|i am|i feel) (?:not safe|unsafe|in danger)|not safe at home|afraid to go home|(?:domestic|partner|intimate partner) (?:violence|abuse)"),
  rule("(?:this is|its|im having|i am having|having|have) an emergency|(?:this is|its) a (?:real |medical )?emergency"),
  rule("(?:need|call|get) (?:an )?(?:ambulance|911|999|112|emergency services)|call the police|i need (?:help|a doctor) (?:right now|now|immediately|urgently)"),

  // ---- medical emergency, English (negatable)
  rule("(?:i|im|i am|am i|i think im|i think i am|i think i might be|i might be|i may be|i feel like im|i feel like i am|it feels like im|its) (?:probably |possibly )?(?:having|getting|about to have|going to have)(?: a| an)? (?:heart attack|stroke|seizure)", { negatable: true }),
  rule("(?:heart attack|stroke) (?:right )?now", { negatable: true }),
  rule("(?:sudden|crushing) chest pain|chest pain (?:right )?now|(?:pain|pressure|tightness) in my chest (?:right )?now|my chest (?:hurts|is hurting|is tight|feels tight|is crushing) (?:right )?now|chest pain and (?:cant breathe|trouble breathing|shortness of breath|sweating|nausea|dizzy|numb\\w*|pain in my (?:arm|jaw))", { negatable: true }),
  rule("(?:im|i am) having (?:severe |sudden |bad |sharp |terrible |crushing )?(?:chest pain|pain in my chest)", { negatable: true, veto: chronicVeto }),
  rule("chest (?:hurts|pain|is tight|feels tight)(?: and)? (?:my )?(?:left )?(?:arm|jaw|shoulder)(?: is)? (?:numb|hurts|tingling|going numb|feels numb)", { negatable: true }),
  rule("(?:face|mouth|smile) (?:is )?(?:drooping|droops|drooped)|(?:speech|words?) (?:is|are) slurred|slurred speech|worst headache of my life", { negatable: true }),
  rule("(?:im|i am) having (?:an? )?(?:bad |severe )?(?:allergic reaction|anaphyla\\w*)|(?:lips?|tongue|face|throat) (?:is|are) swelling", { negatable: true }),
  rule("(?:cant|cannot|can not|couldnt|could not|unable to|struggling to) breathe", { negatable: true, veto: breatheVeto }),
  rule("(?:trouble|difficulty) breathing (?:right )?now|(?:short|shortness) of breath (?:right )?now|(?:gasping|fighting) for (?:air|breath)", { negatable: true }),
  rule("(?:im|i am) having (?:trouble|difficulty|a hard time) breathing", { negatable: true, veto: catchBreathVeto }),
  rule("cant catch my breath", { negatable: true, veto: catchBreathVeto }),
  rule("(?:i think |i feel like )?(?:im|i am) dying", { veto: dyingVeto }),
  rule("(?:throat|airway) (?:is |are )?(?:closing|swelling shut|closing up)|anaphyla\\w*", { negatable: true }),
  rule("(?:wont|cant|doesnt|dont) stop bleeding|bleeding out|cant stop the bleeding|bleeding and (?:it |i )?(?:wont|cant|doesnt|dont) (?:stop|slow down)", { negatable: true }),
  rule("(?:im|i am) choking", { negatable: true }),

  // ---- Spanish
  rule("me quiero morir|quiero morir(?:me)?|quiero matarme|me quiero matar|me voy a matar|voy a matarme|me quiero suicidar"),
  rule("(?:quiero|voy a|quisiera) (?:quitarme|acabar con) (?:la|mi) vida|no quiero (?:vivir|seguir viviendo|estar aqui|seguir)|(?:quisiera|ojala) (?:estar muert[oa]|no despertar|morir)|(?:mejor|estaria mejor) muert[oa]"),
  rule("(?:quiero|quisiera) desaparecer|(?:quiero )?acabar con todo"),
  rule("(?:quiero|voy a|me quiero) (?:hacerme dano|lastimarme|cortarme|herirme|hacerme mal)"),
  rule("ataque (?:al|de) corazon|dolor (?:fuerte )?(?:de|en el) pecho (?:ahora|ya)|me falta el aire (?:ahora|ya)"),
  rule("no puedo respirar", { veto: (h) => /^(?:por la nariz|bien|de noche|cuando|si)\b/.test(h.after) }),
  rule("(?:mi (?:esposo|marido|novio|pareja|papa|padre|mama|madre|hermano|tio|jefe|ex)|el|ella|alguien) me (?:pega|golpea|maltrata|amenaza|abusa|ataca|lastima|hace dano)"),
  rule("no me siento segur[oa]|tengo miedo de mi (?:esposo|marido|novio|pareja|papa|padre)|es una emergencia|necesito una ambulancia"),
];

// ---- Tier 2: broad and noisy on purpose. A hit here never shows the card; it asks for a model check.
const TIER2: readonly RegExp[] = [
  /\b(?:die|dies|dying|deadly|lethal|fatal|suicid\w*|murder\w*|kms|unaliv\w*|overdos\w*|poison\w*|bleach|noose|rope|hang(?:ing|ed)?|jump(?:ing|ed)?|gun|razor)\b/,
  /\b(?:be|am|was|were|wish|rather|better off|want to be|death|my) (?:\w+ )?(?:dead|death)\b|\bdeath wish\b/,
  /\bkill(?:ed|ing|s)? (?:my ?self|himself|herself|themselves|me|him|her|someone|somebody|people|everyone|them|us)\b/,
  /\b(?:not exist|dont exist|disappear\w*|dissapear\w*|vanish\w*|gone forever|never wake|not wake|goodbye|good bye|farewell|last (?:message|note|words|letter|post|day))\b/,
  /\b(?:hurt\w*|harm\w*|burn\w*|scratch\w*|bleed\w*) (?:my ?self|himself|herself)\b|\b(?:cut|cutting) (?:my ?self|my (?:arms?|legs?|thighs?|wrists?|stomach|skin))\b|\bself\b/,
  /\b(?:too many|all my|bunch of|handful of|whole bottle of|bottle of) (?:pills|tablets|meds)\b|\bpills? (?:ready|on purpose)\b/,
  /\b(?:hate (?:my ?self|my life|being alive)|worthless|burden|hopeless|pointless|no point|point (?:in|of)|give up|giving up|gave up|give in)\b/,
  /\b(?:cant|cannot|can not) (?:go on|take|do this|live|cope|stand|keep|handle)\b/,
  /\b(?:end (?:it|my|this|everything|the pain)|ending (?:it|my|this)|tired of (?:living|life|everything|being|it all)|done with (?:life|living|everything|it all)|sick of (?:living|life)|want out|make it stop|stop the pain|better off|miss me|everyone would|do it (?:tonight|tomorrow|today))\b/,
  /\b(?:severe chest pain|chest (?:hurts|is tight|feels tight)|chest pain (?:and|with)|trouble breathing|short(?:ness)? of breath|(?:is|am|im|are) bleeding|bleeding (?:a lot|heavily|badly|everywhere)|bled|seizure|faint\w*|unconscious|passed out|allergic reaction|lips? (?:are|is) swell)/,
  /\b(?:abus\w*|beats? me|hits? me|hurts? me|threat\w*|locks? me|touch\w* me|stalk\w*|forced to|not safe|unsafe|scared to go home|afraid to go home|(?:dont|do not) feel safe)\b/,
  /\b(?:quiero morir|me quiero|matar|desaparecer|no quiero vivir|dolor de pecho|no puedo respirar|me pega)/,
];

const BLANKS = /[\u2800\u180e]/;
const BLANKS_ALL = /[\u2800\u180e]/g;

const LEET_DIGITS =new Map<string, string>([["0", "o"], ["3", "e"], ["4", "a"], ["5", "s"], ["7", "t"]]);

/** The text as is, with "2" read as "to" ("want 2 die"), and with digits inside words read as letters ("w4nt", "d1e", "ki11"). */
function variants(punct: string): string[] {
  const base = punct.replace(/\b2\b/g, "to");
  const readDigits = (one: "i" | "l"): string =>
    base
      .split(" ")
      .map((tok) =>
        /\p{L}/u.test(tok) && /\d/.test(tok) ? Array.from(tok, (c) => (c === "1" ? one : (LEET_DIGITS.get(c) ?? c))).join("") : tok,
      )
      .join(" ");
  return [...new Set([base, readDigits("i"), readDigits("l")])];
}

const WORDS = (s: string): number => s.replace(/,/g, " ").split(" ").filter(Boolean).length;

function hitsRule(r: Rule, scanned: string): boolean {
  // padded so a sentence break at either end splits like any other (" . ")
  const text = ` ${scanned} `;
  r.re.lastIndex = 0;
  for (let m = r.re.exec(text); m !== null; m = r.re.exec(text)) {
    if (m[0] === "") {
      r.re.lastIndex += 1;
      continue;
    }
    const beforeRaw = (text.slice(0, m.index).split(" . ").pop() ?? "").trim();
    const after = (text.slice(m.index + m[0].length).split(" . ")[0] ?? "").replace(/,/g, " ").replace(/ {2,}/g, " ").trim();
    // A match that jumps over a sentence break ("I want to. Die.") counts only when almost nothing follows.
    if (/\s\.\s/.test(m[0]) && WORDS(after) > 3) continue;
    const before = beforeRaw.replace(/,/g, " ").replace(/ {2,}/g, " ").trim();
    if (r.negatable && NEGATION.test(beforeRaw)) continue;
    if (r.veto?.({ before, beforeRaw, after })) continue;
    return true;
  }
  return false;
}

function squashedHit(r: Rule, form: MatchForm): boolean {
  if (!r.squashed) return false;
  r.squashed.lastIndex = 0;
  for (let m = r.squashed.exec(form.squashed); m !== null; m = r.squashed.exec(form.squashed)) {
    if (m[0] === "") {
      r.squashed.lastIndex += 1;
      continue;
    }
    const end = m.index + m[0].length;
    if (squashHitOk(form, m.index, end)) return true;
  }
  return false;
}

/** 'certain' shows the crisis card; 'check' needs a model decision; 'none' continues normally. */
export function crisisTier(text: string): CrisisTier {
  // The Braille blank and the Mongolian vowel separator are stripped (they sit inside words) and also read as a space
  // (they sit between words); a phrase is judged both ways.
  const forms = [matchForm(text)];
  if (BLANKS.test(text)) forms.push(matchForm(text.replace(BLANKS_ALL, " ")));
  let check = false;
  for (const form of forms) {
    if (form.text === "") continue;
    const texts = variants(form.punct);
    for (const r of RULES) {
      if (texts.some((t) => hitsRule(r, t)) || squashedHit(r, form)) return "certain";
    }
    if (texts.some((t) => TIER2.some((re) => re.test(t)))) check = true;
  }
  return check ? "check" : "none";
}

/** True when the text must show the crisis card and must not reach a model (tier 1). */
export const isCrisis = (text: string): boolean => crisisTier(text) === "certain";
