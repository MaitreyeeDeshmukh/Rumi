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
  // A word wildcard inside a counted group, "(?: \w+){0,5}?", becomes the nested quantifier "(?:[a-z]+){0,5}?" once the
  // spaces are gone, which takes seconds on ordinary run-on text. Such a rule gets no letters-only form.
  const nested = /\\w[+*] ?\)[{*+]/.test(src);
  const squashSrc = typeof o.squash === "string" ? o.squash : o.squash === false || nested ? undefined : src.replace(/ /g, "").split("\\w*").join("").split("\\w+").join("[a-z]+");
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
const AUX = "(?:(?:is|are|keeps|keep|has been|have been|was|started|always|sometimes|often|also|will|would|gonna|going to|wants to|threatened to|threatens to) ){0,4}";
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
  rule("(?:i|im|ive) (?:(?:probably|accidentally|definitely|think|might|may|will|could|would|have|had|am|already|almost|nearly|want to|wanna|gonna|going to|about to|need to|thinking of|thinking about|planning to|trying to|tried to|ready to|decided to|dont know if|not sure if|believe i) ){0,4}(?:overdose|overdosed|overdosing)"),
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


  // ---- passive wishes, permanence and "no future" (fix round 1; wording written independently of the tuned set)
  rule("(?:turn|switch|shut) (?:myself|me) (?:off|down) (?:permanently|forever|for good)"),
  rule("(?:want|wanna|wish|need|going|gonna|could) (?:to )?(?:just )?(?:turn|switch|shut) (?:myself|me) (?:off|down)"),
  rule("(?:dont|do not|didnt|no longer|never) (?:wanna|want to|want) (?:to )?(?:continue (?:living|to live)|keep on living|stay alive|be alive anymore|live anymore|live any longer|live much longer|exist anymore)"),
  rule("(?:fall|go) (?:to )?(?:asleep|sleep) and (?:stay|be|remain) (?:asleep|sleeping|gone) forever|(?:sleep|sleeping) forever and never (?:wake|wake up)"),
  rule("(?:tired|sick|exhausted|done|weary) (?:of|with) (?:existing|existence|being here|being a person|being human|being me)"),
  rule("(?:stop|quit) being (?:a person|alive|human)|not be (?:a person|alive|human) (?:anymore|any more)"),
  rule("(?:want|wanna|wish|need|going|gonna|ready) (?:to )?(?:just )?(?:be )?(?:gone|vanish|disappear|leave|vanished) (?:for good|forever|permanently)|(?:want|wanna|wish|ready|going|gonna) (?:to )?leave (?:this|the) world|(?:wish|want|wanna) (?:i|to) (?:could )?(?:just )?(?:vanish|disappear) (?:permanently|forever|for good)"),
  rule("(?:life|living|everything|it all) (?:has|holds|is) (?:no|nothing|without) (?:meaning|point|purpose)|no (?:meaning|purpose|point) (?:left )?(?:in|to) (?:my )?(?:life|anything|existence)|(?:dont|do not|cant|cannot) do (?:life|this life|living) (?:anymore|any more)"),
  rule("(?:i )?(?:see|have) no future (?:for me|for myself|ahead)|(?:there is |theres )?nothing (?:is )?left for me (?:here|anymore|in this life)|(?:im|i am) done being alive"),
  rule("(?:decided|decision) (?:this is|it is|its|that this is) my last (?:week|day|night|weekend|month)"),
  rule("(?:dont|do not) want to wake up anymore|(?:wish|hope) (?:i|id) (?:could|would) (?:just )?(?:never|not) (?:wake|waking) up (?:anymore|again)"),
  rule("(?:happier|better|safer|easier) (?:off )?(?:if i (?:was|were) not (?:around|here|alive|born|gone))"),
  rule("(?:wont|will not) be alive(?: next| tomorrow| after| by| in| for)?"),
  rule("(?:wish|hope|want) (?:i|id|to) (?:could )?(?:just )?(?:vanish|vanished)"),

  // ---- harm to someone else, with an intent word and a person (fix round 1)
  rule(
    "(?:want(?:ed|s)? to|wanna|going to|gonna|about to|plan(?:ning)? to|planning on|thinking (?:about|of)|thought about|thoughts? (?:of|about)|urges? to|impulses? to|decided to|need to|might|could|will|would|keep imagining|imagining|imagine|feel like|felt like|ready to|trying to) (?:just |really |finally |actually |easily )?(?:kill|killing|murder|murdering|stab|stabbing|shoot|shooting|strangle|strangling|choke|choking|poison|poisoning|beat up|beating up|beat|beating|hurt|hurting|harm|harming|hit|hitting|punch|punching|attack|attacking|burn|burning|suffocate|drown|drowning|push|pushing|shove|shoving|kick|kicking|smash|smashing|slap|slapping|cut|cutting|throw|throwing) (?:my |the |a |an |our |his |her |their )?(?:\\w+ )?(?:kids|children|family|parents|pets|dog|cat|students|patients|his (?:face|head|skull|neck|throat)|her (?:face|head|skull|neck|throat)|their (?:face|head|skull|neck|throat)|brother|sister|mom|mum|mother|dad|father|boss|teacher|caregiver|carer|roommate|neighbou?r|husband|wife|partner|son|daughter|kid|child|baby|ex|him|her|them|someone|somebody|everyone|people|coworker|colleague|doctor|nurse|girlfriend|boyfriend|friend|landlord|classmate|grandma|grandpa|uncle|aunt|cousin|stepdad|stepmom|stepfather|stepmother)",
    { squash: false, negatable: true },
  ),
  rule(
    "(?:want to|wanna|going to|gonna|about to|plan(?:ning)? to|thinking (?:about|of)|decided to|need to|might|will) (?:shoot(?:ing)? up|blow(?:ing)? up|bomb(?:ing)?|burn(?:ing)? down|set(?:ting)? fire to) (?:the |my |a |this )?(?:school|class|classroom|office|clinic|hospital|building|house|church|mall|store|workplace|place)",
    { squash: false, negatable: true },
  ),
  rule("(?:burn|burning|set fire to) (?:the |my )?house down with (?:them|everyone|him|her|people) inside|(?:make|making) (?:them|him|her|everyone) (?:pay|suffer|bleed) with (?:violence|blood)", { squash: false }),

  // ---- medical emergencies, other forms (fix round 1)
  rule("(?:throwing up|throw up|threw up|vomiting|vomited|vomit|coughing up|coughed up|cough up|spitting up|spat up|puking|puked|passing|peeing|pooping) (?:a lot of |some |bright red |lots of )?blood", { negatable: true, squash: false }),
  rule("blood (?:everywhere|wont stop|will not stop|is pouring|keeps coming|gushing|is gushing)|(?:the )?bleeding (?:wont|will not|doesnt|does not) (?:stop|slow)", { negatable: true, squash: false }),
  rule(
    "(?:my |our )?(?:child|baby|son|daughter|kid|toddler|infant|dad|mom|mum|father|mother|husband|wife|friend|brother|sister|grandma|grandpa|grandmother|grandfather|he|she|they) (?:has |have |just |is |are )?(?:stopped|isnt|is not|not|stops|wont|cant|cannot|will not) (?:breathing|breathe|responding|waking up|wake up|moving)|(?:unresponsive|not responding|wont wake up|not waking up|isnt responding|is not responding|collapsed|is unconscious|are unconscious)",
    { squash: false },
  ),
  rule("(?:swallowed|ate|drank|ingested|inhaled) (?:a |an |some |the )?(?:battery|batteries|magnets?|bleach|poison|detergent|cleaning (?:fluid|product))", { squash: false }),
  rule("(?:took|taken|take|swallowed|had) too much (?:of my )?(?:medicine|medication|meds|insulin|painkillers|paracetamol|tylenol|aspirin|sleeping pills)", { squash: false }),
  rule("(?:face|one side of my (?:face|body)) (?:feels |is |went |suddenly )?(?:numb|droopy|drooping|paralyzed|paralysed)(?: on one side)?", { negatable: true, squash: false }),
  rule("(?:crushing|heavy|severe|intense) (?:pressure|weight) (?:in|on) (?:my )?chest|pressure in my chest (?:and|with)|chest pain (?:and|with) (?:my |the )?(?:left )?(?:arm|jaw|hand)", { negatable: true, squash: false }),
  rule("(?:he|she|they|someone|somebody|my \\w+) (?:is|are|just|has) (?:having|had) (?:a |an )?(?:seizure|heart attack|stroke|allergic reaction)", { negatable: true, squash: false }),

  // ---- second round of widening (after the first tuning set was measured): more shapes, same care
  rule("(?:dont|do not|cant|cannot) (?:see|know) (?:why|how) (?:i|to) (?:should |can |could )?(?:keep going|go on|continue|carry on|keep living|stay)", { squash: false }),
  rule("(?:want|wish|need|hope) it to all (?:be )?(?:over|end|stop)|(?:want|wanna) to (?:just )?(?:rest|sleep) forever|(?:fall|go) (?:to )?(?:asleep|sleep) and never (?:come back|wake|wake up|get up|open my eyes)", { squash: false }),
  rule("(?:there is|theres|feel like there is|feel like theres) no (?:way out|escape|way forward|way to go on)", { squash: false }),
  rule("(?:want|wanna|wish|ready|going|gonna|need) (?:to )?(?:quit|leave|exit) (?:life|living)", { squash: false }),
  rule("(?:hope|wish) (?:i|id) (?:do not|dont|wont|will not|never) (?:wake up|wake)", { squash: false }),
  rule("(?:intend|intending|plan|planning|aim|aiming|mean|meaning) (?:to|on) (?:die|dying|kill myself|end my life|hurt myself|harm myself|end it)", { squash: false }),
  rule("(?:going to|gonna|want to|wanna|will|about to) make (?:him|her|them|everyone|you) (?:bleed|suffer|regret it with)", { squash: false, negatable: true }),
  rule("(?:will|going to|gonna|want to|wanna|plan to) (?:go )?(?:find|hunt|track) (?:him|her|them|you)(?: down)? and (?:hurt|kill|hit|beat|stab|shoot|harm|punch|strangle)", { squash: false, negatable: true }),
  rule("(?:angry|mad|furious|enraged) enough to (?:kill|murder|hurt|stab|hit|strangle|shoot)", { squash: false }),
  rule("(?:would like|want|wish|hope|wanna) (?:to see )?(?:them|him|her|everyone|people|my \\w+) (?:dead|gone forever|suffer)|(?:wish|hope) (?:them|him|her) (?:dead|were dead|was dead)", { squash: false, negatable: true }),
  rule("(?:cant|cannot|can not|couldnt) (?:get|catch|take|draw) (?:any |enough |a )?(?:air|breath)", { squash: false, negatable: true, veto: catchBreathVeto }),
  rule("(?:turning|turned|going|gone) (?:blue|purple|grey|gray)|blue lips|lips (?:are |turning )?blue", { squash: false, negatable: true }),
  rule("(?:he|she|they|my \\w+|someone|somebody) (?:is|are|was) choking", { squash: false, negatable: true }),
  rule("(?:is|are|went|goes|became|feels) limp|(?:is|are) (?:not|no longer) (?:moving|breathing|responding|waking up)|isnt (?:moving|breathing|responding|waking up)", { squash: false }),
  rule("blood in (?:my|his|her|the) vomit", { squash: false, negatable: true }),
  rule("(?:my )?chest (?:is |feels )?(?:crushing|tight|squeezing|burning)(?: and| with) (?:my )?(?:left |right )?(?:arm|jaw|shoulder|hand)s?", { squash: false, negatable: true }),
  rule("(?:i|ive|i have|i was|im|i got|i am) (?:been |got )?(?:stabbed|shot|run over|poisoned)|(?:someone|somebody|he|she|they) (?:stabbed|shot|ran over|poisoned) me", { squash: false, negatable: true }),
  rule("(?:i )?(?:got|been|was|have been) (?:hit|run over|struck) by (?:a |an )(?:car|truck|bus|bike|train|motorcycle)", { squash: false, veto: (h) => /^(?:last|when|years?|months?|weeks?|ago|once|as a|in )/.test(h.after) }),

  rule("(?:plan|plans) (?:is |are )?to (?:overdose|die|end it|kill myself|end my life|take (?:all )?my pills)", { squash: false }),
  rule("(?:no|not any) reason (?:to be here|for me to be here|to be around|to stay)|(?:cant|cannot|do not think i can|dont think i can) (?:stay|stick around|remain) (?:in this world|here|alive)(?: much longer| any longer)?", { squash: false }),
  rule("(?:clutch\\w*|grabb?\\w*) (?:his|her|their|my) chest and (?:fell|collapsed|dropped|went down)", { squash: false }),

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
  // ---- fix round 1: every category the roaster named must at least reach the classifier. Noisy on purpose.
  /\b(?:never (?:been )?(?:born|borne)|turn(?:ing)? (?:my ?self|me) off|shut (?:my ?self|me) down|continue (?:living|to live)|keep (?:on )?living|stay (?:alive|asleep)|being alive|existing|existence|be gone|gone for good|permanently|leave this world|asleep forever|sleep forever|without me|happier (?:if|without)|not be around|stop being|done being|no future|nothing left|no meaning|meaningless|no purpose|do life|nobody (?:would|will) (?:notice|care|miss)|no one (?:would|will) (?:notice|care|miss)|last (?:week|day|night|weekend|month) (?:of|alive|here)|my last (?:week|day|night))\b/,
  /\b(?:kill|killing|murder|murdering|stab|stabbing|shoot|shooting|strangl\w*|chok\w*|poison\w*|beat(?:ing)? up|attack\w*|assault\w*|hurt|hurting|harm|harming|hit|hitting|punch\w*|burn(?:ing)? down|violen\w*|revenge|make (?:them|him|her) pay|pay for it) (?:my |the |a |an |our |his |her |their )?(?:\w+ )?(?:brother|sister|mom|mum|mother|dad|father|boss|teacher|caregiver|carer|roommate|neighbou?r|husband|wife|partner|son|daughter|kid|child|baby|ex|him|her|them|someone|somebody|everyone|people|coworker|colleague|doctor|nurse|girlfriend|boyfriend|friend|landlord|classmate|school|house)\b|\b(?:shoot up|blow up|bomb\w*|weapon|massacre|school shooting)\b|\bwith (?:violence|them inside)\b/,
  /\b(?:throwing up|threw up|vomit\w*|coughing up|coughed up|spitting up|puk\w*) (?:\w+ )?blood\b|\bblood (?:in|on|everywhere|wont|keeps|is coming|loss|pouring|gushing)\b|\b(?:stopped|stops|isnt|not|wont|cant) (?:breathing|breathe|responding|waking|moving)\b|\b(?:unresponsive|collaps\w*|unconscious|paralyz\w*|paralys\w*|droop\w*|slurred|swallowed (?:a )?(?:battery|magnet|bleach|poison)|too much (?:medicine|medication|insulin|meds)|pass(?:ing)? out|pressure in my chest|crushing|numb (?:on|in|and)|(?:arm|face|leg|hand|side) (?:is |feels |went )?numb|ambulance|911|emergency)\b/,
  /\b(?:fact,? not (?:a )?feeling|not (?:a )?feeling|stating (?:a )?fact|this is (?:a )?fact|(?:mean|meant) (?:it|this) literally|taking (?:this|it) literally|not (?:a )?(?:figure of speech|joke|metaphor|exaggerat\w*|kidding)|not exaggerating|being literal|to be (?:clear|literal)|i am serious|im serious|plainly)\b/,
  /\b(?:have|got|bought) (?:the |my |a |some )?(?:pills|rope|gun|razor|knife|blade)s?\b.{0,40}\b(?:will|going to|gonna|plan to|tonight|today|tomorrow)\b|\boverdo(?:es|se|ze)\b|\b(?:alve|alie|lfe|lyfe)\b/,
  /\b(?:rest forever|sleep forever|want it to (?:all )?(?:be )?(?:over|end|stop)|no way out|quit life|burden|planning my goodbye|goodbye|a car hit me|ready to (?:go|leave|die)(?: now| soon)?$|bleed|see them dead|angry enough|find (?:him|her|them)|limp|wont wake up|will not wake up|turning blue|blue lips|not moving|choking|stabbed|shot me|hit by a (?:car|truck|bus)|cant get any air|any air|chest (?:tightness|pressure))\b/,
  /\b(?:in this world|hope (?:that )?(?:this |it )?is the end|funeral|given away my|giving away my|written letters|letters for my family|no reason to be here|reason to be here|stay alive|erased|calm when i think|waking up when|point of waking)\b/,
  /\b(?:getting|get|buy|bought|grab|grabbing|find) (?:a |the |my )?(?:knife|gun|weapon|bat|hammer|blade)\b|\b(?:break|breaking|smash|smashing|crush|crushing|snap|snapping) (?:someones?|his|her|their|a)? ?(?:arm|leg|neck|face|nose|jaw|bones?)\b|\b(?:picture|picturing|imagin\w+) (?:my \w+|him|her|them|someone) (?:falling|dead|hurt|bleeding|dying)\b/,
  /\b(?:grabb?\w*|clutch\w*) (?:his|her|their|my) chest\b|\b(?:floppy|will not feed|wont feed|will not answer|wont answer|cannot see out of|cant see out of|lost (?:my )?vision|worst headache|(?:took|taken|swallowed) (?:a lot|lots|many|loads) of (?:pills|tablets|meds)|(?:wont|will not) be (?:here|around|alive) (?:after|next|past|by|beyond))\b/,
  /\b(?:not (?:a )?mood|for the record|read this literally|not hyperbole|not (?:being )?dramatic|not asking for a metaphor|is a plan)\b/,
  /\b(?:i intend|sentence is literal|literal\w*,? (?:i|this)|exactly what i say|not an expression|not speaking in a figure|stating objectively|factual statement|telling you directly|do not interpret|reporting a fact)\b/,
];

/** Characters of one string that crisisTier scans. */
const MAX_SCAN_CHARS = 4000;

const BLANKS = /[\u2800\u180e]/;
const BLANKS_ALL = /[\u2800\u180e]/g;

const LEET_DIGITS =new Map<string, string>([["0", "o"], ["3", "e"], ["4", "a"], ["5", "s"], ["7", "t"]]);

/**
 * Typos and phonetic spellings of the few words the rules cannot do without ("kil", "myslef", "suiside", "borne").
 * An explicit list for short words (a distance rule would turn "will" into "kill"), and an edit distance only for the
 * long, distinctive ones, where almost no ordinary word is that close.
 */
const TYPO_WORDS = new Map<string, string>([
  ...["dai", "diee", "dieee", "dyie", "dei", "diie"].map((w): [string, string] => [w, "die"]),
  ...["dyin", "dyng", "dieing", "dyying"].map((w): [string, string] => [w, "dying"]),
  ...["kil", "kll", "kiil", "killl", "kilil", "kiill"].map((w): [string, string] => [w, "kill"]),
  ...["kiling", "killng", "killin", "killling"].map((w): [string, string] => [w, "killing"]),
  ...["kiled", "killd"].map((w): [string, string] => [w, "killed"]),
  ...["hurtng", "hurtin", "hurtig"].map((w): [string, string] => [w, "hurting"]),
  ...["wnt", "wnat", "wanr", "wantt", "wan"].map((w): [string, string] => [w, "want"]),
  ...["gona", "gonnna", "gunna", "gonaa"].map((w): [string, string] => [w, "gonna"]),
  ...["alve", "aliv", "alvie", "alivee"].map((w): [string, string] => [w, "alive"]),
  ...["lfe", "lyfe"].map((w): [string, string] => [w, "life"]),
  ["borne", "born"],
  ...["evrything", "everthing", "everyting", "evrythng"].map((w): [string, string] => [w, "everything"]),
  ...["liv", "livv"].map((w): [string, string] => [w, "live"]),
  ...["ded", "deadd"].map((w): [string, string] => [w, "dead"]),
  ...["cuting", "cuttin"].map((w): [string, string] => [w, "cutting"]),
  ...["overdosin", "overdosng"].map((w): [string, string] => [w, "overdosing"]),
  ...["whant", "whnat", "wwant"].map((w): [string, string] => [w, "want"]),
  ["ende", "end"],
  ...["overdoze", "overdoos"].map((w): [string, string] => [w, "overdose"]),
]);
const FUZZY: ReadonlyArray<{ target: string; first: string; max: number }> = [
  { target: "myself", first: "m", max: 1 },
  { target: "suicide", first: "s", max: 2 },
  { target: "suicidal", first: "s", max: 2 },
];
/** Real words that are close to a target but mean something else. */
const FUZZY_GUARD = new Set(["subside", "subsides", "subsided", "suicides", "myselfs"]);

/** Optimal-string-alignment distance (insert, delete, replace, swap of two neighbours), at most `max` or else max + 1. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function fuzzToken(tok: string): string {
  const direct = TYPO_WORDS.get(tok);
  if (direct !== undefined) return direct;
  if (tok.length < 5 || tok.length > 9 || FUZZY_GUARD.has(tok)) return tok;
  let best = tok;
  let bestDistance = Infinity;
  for (const { target, first, max } of FUZZY) {
    if (tok[0] !== first || tok === target) continue;
    const dist = editDistance(tok, target, max);
    if (dist <= max && dist < bestDistance) [best, bestDistance] = [target, dist];
  }
  return best;
}

/** The text with typos of the key words put right. The same words, in the same order, so every rule still reads it normally. */
const fuzzed = (punct: string): string =>
  punct
    .split(" ")
    .map(fuzzToken)
    .join(" ")
    .replace(/\b(want|wanna|wana|going|gonna|need|wish|ready) too\b/g, "$1 to") // "i want too die"
    .replace(/\bit al\b/g, "it all"); // "ending it al"

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
  const read = readDigits("i");
  return [...new Set([base, read, readDigits("l"), fuzzed(base), fuzzed(read)])];
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
export function crisisTier(input: string): CrisisTier {
  // A hard cap on what is scanned per call. Request fields are capped far below this by their schemas; a longer string is
  // scanned only up to the cap and, if nothing certain is found, handed to the model check instead of being trusted.
  const text = input.length > MAX_SCAN_CHARS ? input.slice(0, MAX_SCAN_CHARS) : input;
  const tooLong = input.length > MAX_SCAN_CHARS;
  // The Braille blank and the Mongolian vowel separator are stripped (they sit inside words) and also read as a space
  // (they sit between words); a phrase is judged both ways.
  const forms = [matchForm(text)];
  if (BLANKS.test(text)) forms.push(matchForm(text.replace(BLANKS_ALL, " ")));
  // "h*rt", "k*ll": a star between letters hides a vowel, which could be one of two. Both are tried.
  if (/\p{L}\*\p{L}/u.test(text)) for (const vowel of ["u", "i"]) forms.push(matchForm(text.replace(/(\p{L})\*(?=\p{L})/gu, `$1${vowel}`)));
  let check = false;
  for (const form of forms) {
    if (form.text === "") continue;
    const texts = variants(form.punct);
    for (const r of RULES) {
      if (texts.some((t) => hitsRule(r, t)) || squashedHit(r, form)) return "certain";
    }
    if (texts.some((t) => TIER2.some((re) => re.test(t)))) check = true;
  }
  return check || tooLong ? "check" : "none";
}

/** True when the text must show the crisis card and must not reach a model (tier 1). */
export const isCrisis = (text: string): boolean => crisisTier(text) === "certain";
