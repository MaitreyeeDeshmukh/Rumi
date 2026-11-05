/**
 * Deterministic crisis check. Never routed through a model. A regex layer, not a complete safety system:
 * a trained person must review this file before launch (07 D4). The server is the gate; the browser copy is best effort.
 *
 * Bias: when unsure, show the crisis card. Known false positives are listed in tests/unit/crisis.test.ts and kept on purpose.
 *
 * It runs on `matchForm` (07 D1), which is built from the exact text a model would see, so a phrase cannot slip past
 * by hiding behind tags, invisible characters, combining marks or Cyrillic and Greek lookalikes. A letters-only copy
 * catches spaced-out or digit-swapped spellings, but only for rules where no exception is needed.
 *
 * Deviations from 07 D3, each with a reason:
 *  - "no/not/without within three words" is applied only to the medical-emergency rules, and only when the negation
 *    sits directly before the phrase (`no chest pain right now`). A negation anywhere near a self-harm phrase must not
 *    hide it ("I am not lying, I want to die"). It applies to "can't breathe", "chest pain now" and "heart attack".
 *  - `end everything`, `end it`, `hurt myself` and `cut myself` carry small exceptions so that "end everything on my
 *    list", "end it with my boyfriend", "I hurt myself lifting a box" and "I cut myself shaving" do not trigger.
 */
import { matchForm } from "@/lib/ai/guards/input";

interface Hit {
  /** Words of the same sentence before the match. */
  before: string;
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
  /** true: same pattern with spaces removed. A string: a custom letters-only pattern. */
  squash?: boolean | string;
  negatable?: boolean;
  veto?: (hit: Hit) => boolean;
}

/** Words are separated by a single space in `src`; a space becomes `\s+` in the spaced form and disappears in the squashed form. */
function rule(src: string, o: RuleOptions = {}): Rule {
  const re = new RegExp(String.raw`\b(?:${src.replace(/ /g, String.raw`\s+`)})\b`, "g");
  const squashSrc = o.squash === true ? src.replace(/ /g, "") : typeof o.squash === "string" ? o.squash : undefined;
  return { re, squashed: squashSrc ? new RegExp(squashSrc) : undefined, negatable: o.negatable ?? false, veto: o.veto };
}

const INTENT_WORDS =
  "want(?:ed)? to|wanna|going to|gonna|need to|plan(?:ning)? to|trying to|tried to|keep|keeps|kept|urge to|about to|thinking (?:about|of)|thought about|feel like|ready to|decided to|will|would|might|could|have to|used to|started|start to|so i can|in order to";
const INTENT_BEFORE = new RegExp(String.raw`(?:${INTENT_WORDS})(?:\s+(?:just|really|actually|again|also|sometimes|often|always|i|and))*\s*$`);
const ACCIDENT = /\b(?:shaving|shave|cooking|chopping|slicing|paper|vegetables|opening|kitchen|glass|door|accident\w*|by mistake|fell|fall|falling|tripped|slipped|lifting|carrying|moving|playing|exercising|working|running|walking|skiing|gym|workout|yesterday|ago|last|while|when|today|this morning|stubbed|knife)\b/;
const PURPOSE = /\b(?:again|on purpose|deliberately|to hurt|to feel|to cope|to punish|to relieve|every day|every night|every week|scars?)\b/;

const lastWords = (s: string, n: number): string => s.split(" ").slice(-n).join(" ");
const firstWords = (s: string, n: number): string => s.split(" ").slice(0, n).join(" ");

/** Hurt or burn myself: crisis unless it reads like an accident ("I hurt myself lifting a box"). */
const hurtVeto = (h: Hit): boolean => {
  if (INTENT_BEFORE.test(h.before) || PURPOSE.test(firstWords(h.after, 6))) return false;
  return ACCIDENT.test(`${lastWords(h.before, 4)} ${firstWords(h.after, 6)}`);
};

/** Cut myself: crisis only with a stated purpose, repeated action, intent, or bleeding that is not an accident. */
const cutVeto = (h: Hit): boolean => {
  const near = firstWords(h.after, 8);
  if (PURPOSE.test(near) || INTENT_BEFORE.test(h.before)) return false;
  if (/\bbleeding\b/.test(near)) return ACCIDENT.test(`${lastWords(h.before, 3)} ${near}`);
  return true;
};

/** "end everything" is crisis only when nothing about a list or task follows. */
const endEverythingVeto = (h: Hit): boolean => !/^(?:now|tonight|today|soon|tomorrow|forever|for good|right now|please|already|here)?$/.test(h.after);

const endItVeto = (h: Hit): boolean => /^(?:with|between|before|after|when|if|because|for|here|there|early|this|the)\b/.test(h.after);

/** "I have been cutting" alone is self-harm. "cutting vegetables", "cutting back", "cutting my hair" are not. */
const cuttingBareVeto = (h: Hit): boolean => !/^(?:again|a lot|more|lately|deeper|every day|every night)?$/.test(h.after);

/** Idioms such as "my boss will kill me if I am late". Ambiguous threats from a person are handled by the abuse rules. */
const killMeVeto = (h: Hit): boolean => /^(?:if|when|because|unless|for|with|laughing|trying)\b/.test(h.after);

const dyingVeto = (h: Hit): boolean => /^(?:to|of|for|laughing|inside|from|without|here)\b/.test(h.after);

const breatheVeto = (h: Hit): boolean =>
  /^(?:through|out of|well|at night|when|while|during|if|after|before|once|whenever|lying|laying|every|since|because|in the|in my sleep|on stairs|with|much|easily|deeply|fully|enough)\b/.test(h.after);

const catchBreathVeto = (h: Hit): boolean => /^(?:when|after|while|if|since|because|during)\b/.test(h.after);

const NEGATION = /(?:^|\s)(?:no|not|dont|doesnt|didnt|havent|hasnt|never|without|denies|denied|nor)(?:\s+(?:have|having|had|got|get|feel|feeling|felt|any|a|an|the|currently|really|experiencing|experience|or|and|even|such))*\s*$/;

const PEOPLE =
  "(?:he|she|they|someone|somebody|my (?:boyfriend|girlfriend|partner|husband|wife|ex|dad|mom|mum|mother|father|brother|sister|uncle|aunt|stepdad|stepmom|stepfather|stepmother|roommate|caregiver|carer|boss|teacher|coach|son|daughter|parent|parents|grandfather|grandmother|grandpa|grandma|cousin|neighbor|landlord))";
const AUX = "(?:(?:is|are|keeps|keep|has been|have been|was|started|just|always|sometimes|often|also|will|would|gonna|going to|wants to|threatened to|threatens to) )*";

const RULES: readonly Rule[] = [
  // ---- suicide and self-harm, English
  rule("(?:kill|killing|hang|hanging|shoot|shooting|stab|stabbing|poison|poisoning|drown|drowning|suffocate|suffocating|strangle|strangling|starve|starving) (?:myself|my self)", { squash: true }),
  rule("(?:hurt|hurting|harm|harming|injure|injuring|burn|burning|punish|punishing|hit|hitting|bite|biting|scratch|scratching) (?:myself|my self)", {
    veto: hurtVeto,
    squash: String.raw`(?:wantto|wanna|gonna|goingto|needto|tryingto|keep|urgeto)(?:hurt|harm)myself`,
  }),
  rule("(?:cut|slit|slash) (?:myself|my self|my arms?|my legs?|my thighs?|my skin|my body)", { veto: cutVeto }),
  rule("(?:cutting|slitting|slashing) (?:myself|my self|my arms?|my legs?|my thighs?|my skin|my body)", { veto: hurtVeto }),
  rule("(?:ive been|i have been|ive started|i started|i keep|keep|im|i am) cutting", { veto: cuttingBareVeto }),
  rule("(?:cut|cutting|slit|slitting|slash|slashing) (?:my wrists?|my throat)", { squash: String.raw`(?:cut|slit|slash)(?:my)?(?:wrists?|throat)` }),
  rule("kill me", { veto: killMeVeto }),
  rule("(?:want(?:ed)? to|wanna|going to|gonna|about to|ready to|plan(?:ning)? to|decided to|need to|tried to|trying to|thinking (?:about|of)|thought about|hope to|wish to|rather) (?:just |finally |really |actually |simply )?(?:die|dying|be dead|not be alive|not exist|not be here|stop existing|disappear|stop living|not wake up|go to sleep and not wake up)", {
    squash: String.raw`(?:wantto|wanna|gonna|goingto)(?:just)?die(?!t)`,
  }),
  rule("(?:wish|hope) (?:i|id|that i|that id) (?:was|were|am) (?:dead|not here|not alive|never born)"),
  rule("(?:wish|hope) (?:i|id|that i|that id) (?:wasnt|werent|was not|were not) (?:alive|here|born|around)"),
  rule("(?:wish|hope) (?:i|id|that i|that id) (?:could|would|can|might|will) (?:just )?(?:die|disappear|be dead|not wake up|go to sleep and not wake up|end it|stop existing|stop living)"),
  rule("(?:wish|hope) (?:i|id|that i|that id)(?: had)? (?:never|hadnt|didnt|dont|wont) (?:been born|born|woke up|woken up|wake up|existed|exist)"),
  rule("better off (?:dead|without me|if i (?:was|were|wasnt|werent) (?:gone|dead|here|around|alive|born)|if i (?:died|disappeared|vanished|didnt exist))", {
    squash: String.raw`betteroff(?:dead|withoutme)`,
  }),
  rule("(?:dont|do not|didnt|did not|no longer|never) (?:wanna|want to|want) (?:be here|live|be alive|exist|go on|be around|keep going|wake up tomorrow|wake up again)", {
    squash: String.raw`(?:dont|donot)(?:wanna|wantto)(?:live|bealive|exist|goon)`,
  }),
  rule("(?:cant|cannot|can not) (?:go on|keep going|take it anymore|take this anymore|do this anymore|do this any more)"),
  rule("(?:want|wish|need) (?:it all|everything|all of it) to (?:end|stop|be over|go away)"),
  rule("(?:no (?:reason|point|purpose) (?:to|in) (?:live|living|go on|going on|be alive|being alive)|nothing to live for|not worth living|life (?:is|isnt|was|wasnt) (?:not )?worth (?:living|it)|no point (?:in )?(?:living|going on|being alive)|the point of (?:living|going on|being alive))", {
    squash: String.raw`(?:notworthliving|nothingtolivefor|noreasontolive)`,
  }),
  rule("end(?:ing|ed)? (?:it all|my life|my own life|my suffering)", { squash: String.raw`end(?:ing|ed)?(?:itall|mylife|myownlife)` }),
  rule("end(?:ing)? everything", { veto: endEverythingVeto }),
  rule("(?:want(?:ed)? to|wanna|going to|gonna|ready to|need to|planning to|plan to|decided to|about to|trying to) end it", { veto: endItVeto }),
  rule("end it (?:now|tonight|today|soon|forever|for good)"),
  rule("(?:take|taking|took|taken|end|ending|ended) my (?:own )?life", { squash: String.raw`(?:take|taking|took|taken|end|ending|ended)my(?:own)?life` }),
  rule("suicid\\w*", { squash: "suicid" }),
  rule("kms"),
  rule("unaliv\\w*", { squash: "unaliv" }),
  rule("(?:selfharm|self harm|selfinjur\\w*|self injur\\w*|selfmutilat\\w*|self mutilat\\w*)\\w*", { squash: "selfharm" }),
  rule("jump(?:ing|ed)? (?:off|from|out of) (?:a |the |my )?(?:bridge|building|roof|balcony|cliff|window|overpass|tower)"),
  rule("(?:jump|jumping|step|stepping) (?:out )?in front of (?:a |the )?(?:train|bus|car|truck|traffic|subway)"),
  rule(`(?:i|im|ive) (?:(?:just|probably|maybe|accidentally|actually|definitely|really|think|might|may|will|could|would|have|had|am|already|almost|nearly|want to|wanna|gonna|going to|about to|need to|thinking of|thinking about|planning to|trying to|tried to|ready to|decided to|dont know if|not sure if|believe i) )*(?:overdose|overdosed|overdosing)`),
  rule("(?:is|are|was) overdosing|just overdosed|overdosing right now|overdosed right now"),
  rule("(?:took|taken|swallowed) (?:way )?too many (?:pills|tablets|meds|medications|medicine|painkillers|capsules)"),
  rule("(?:took|swallowed|swallowing) (?:a |the )?(?:whole|entire) bottle of"),
  rule("(?:took|swallowed|swallowing) (?:a bunch of|a handful of|a whole bunch of|all of my|all my) (?:my |the )?(?:pills|tablets|meds|medication|medicine)"),
  rule("(?:hope|wish) i (?:dont|never|wont) wake up|go to sleep and never wake up|dont want to wake up (?:tomorrow|again|ever)"),

  // ---- danger from another person, English
  rule(`${PEOPLE} ${AUX}(?:hit|hits|hitting|beat|beats|beating|abuse|abuses|abusing|abused|threaten|threatened|threatens|threatening|choke|choked|chokes|choking|strangle|strangled|strangles|strangling|rape|raped|rapes|raping|assault|assaulted|assaults|assaulting|slap|slapped|slaps|slapping|punch|punched|punches|punching|kick|kicked|kicks|kicking|shove|shoved|push|pushed|grab|grabbed|molest\\w*|stalk\\w*|harass\\w*|attack\\w*|hurt|hurts|hurting) me`),
  rule("(?:being|been|im|i am|ive been|i was|i have been) (?:physically |sexually |emotionally )?(?:abused|beaten|raped|assaulted|molested|stalked|trafficked|threatened|choked|strangled)"),
  rule("being (?:physically |sexually |emotionally )?(?:hurt|hit|harmed|mistreated|locked up|controlled|forced)"),
  rule("(?:scared|afraid|terrified|frightened) (?:of|for my life) (?:my )?(?:partner|husband|wife|boyfriend|girlfriend|dad|father|mom|mother|brother|sister|uncle|stepdad|caregiver|boss|ex|him|her|them)"),
  rule("(?:dont|do not|no longer|never) feel safe|(?:im|i am|i feel) (?:not safe|unsafe|in danger)|not safe at home|afraid to go home|(?:domestic|partner|intimate partner) (?:violence|abuse)"),
  rule("(?:this is|its|im having|i am having|having|have) an emergency|(?:this is|its) a (?:real |medical )?emergency"),
  rule("(?:need|call|get) (?:an )?(?:ambulance|911|999|112|emergency services)|call the police|i need (?:help|a doctor) (?:right now|now|immediately|urgently)"),

  // ---- medical emergency, English (negatable, never squashed)
  rule("(?:i|im|i am|am i|i think im|i think i am|i think i might be|i might be|i may be|i feel like im|i feel like i am|it feels like im|its) (?:probably |possibly )?(?:having|getting|about to have|going to have)(?: a| an)? (?:heart attack|stroke|seizure)", { negatable: true }),
  rule("(?:heart attack|stroke) (?:right )?now", { negatable: true }),
  rule("(?:sudden|crushing) chest pain|chest pain (?:right )?now|(?:pain|pressure|tightness) in my chest (?:right )?now|my chest (?:hurts|is hurting|is tight|feels tight|is crushing) (?:right )?now|chest pain and (?:cant breathe|trouble breathing|shortness of breath|sweating|nausea|dizzy|numb\\w*|pain in my (?:arm|jaw))", { negatable: true }),
  rule("(?:cant|cannot|can not|couldnt|could not|unable to|struggling to) breathe", { negatable: true, veto: breatheVeto }),
  rule("(?:trouble|difficulty) breathing (?:right )?now|(?:short|shortness) of breath (?:right )?now|(?:gasping|fighting) for (?:air|breath)", { negatable: true }),
  rule("cant catch my breath", { negatable: true, veto: catchBreathVeto }),
  rule("(?:i think |i feel like )?(?:im|i am) dying", { veto: dyingVeto }),
  rule("(?:throat|airway) (?:is |are )?(?:closing|swelling shut|closing up)|anaphyla\\w*", { negatable: true }),
  rule("(?:wont|cant|doesnt|dont) stop bleeding|bleeding out|cant stop the bleeding|bleeding and (?:it |i )?(?:wont|cant|doesnt|dont) (?:stop|slow down)", { negatable: true }),
  rule("(?:im|i am) choking", { negatable: true }),

  // ---- Spanish
  rule("me quiero morir|quiero morir(?:me)?|quiero matarme|me quiero matar|me voy a matar|voy a matarme|me quiero suicidar", {
    squash: String.raw`(?:mequieromorir|quieromatarme|mevoyamatar)`,
  }),
  rule("(?:quiero|voy a|quisiera) (?:quitarme|acabar con) (?:la|mi) vida|no quiero (?:vivir|seguir viviendo|estar aqui|seguir)|(?:quisiera|ojala) (?:estar muert[oa]|no despertar|morir)|(?:mejor|estaria mejor) muert[oa]"),
  rule("(?:quiero|voy a|me quiero) (?:hacerme dano|lastimarme|cortarme|herirme|hacerme mal)"),
  rule("ataque (?:al|de) corazon|dolor (?:fuerte )?(?:de|en el) pecho (?:ahora|ya)|me falta el aire (?:ahora|ya)"),
  rule("no puedo respirar", { veto: (h) => /^(?:por la nariz|bien|de noche|cuando|si)\b/.test(h.after) }),
  rule("(?:mi (?:esposo|marido|novio|pareja|papa|padre|mama|madre|hermano|tio|jefe|ex)|el|ella|alguien) me (?:pega|golpea|maltrata|amenaza|abusa|ataca|lastima|hace dano)"),
  rule("no me siento segur[oa]|tengo miedo de mi (?:esposo|marido|novio|pareja|papa|padre)|es una emergencia|necesito una ambulancia"),
];

function hitsRule(r: Rule, text: string): boolean {
  r.re.lastIndex = 0;
  for (let m = r.re.exec(text); m !== null; m = r.re.exec(text)) {
    if (m[0] === "") {
      r.re.lastIndex += 1;
      continue;
    }
    const before = (text.slice(0, m.index).split(".").pop() ?? "").trim();
    const after = (text.slice(m.index + m[0].length).split(".")[0] ?? "").trim();
    if (r.negatable && NEGATION.test(before)) continue;
    if (r.veto?.({ before, after })) continue;
    return true;
  }
  return false;
}

/** True when the text must show the crisis card and must not reach a model. */
export function isCrisis(text: string): boolean {
  const { text: t, squashed } = matchForm(text);
  if (t === "") return false;
  for (const r of RULES) {
    if (r.squashed?.test(squashed)) return true;
    if (hitsRule(r, t)) return true;
  }
  return false;
}
