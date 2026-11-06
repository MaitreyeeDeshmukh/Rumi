/**
 * Shared word lists for the grounding and advice checks. Plain data, no logic.
 * Owner: features lane writes additions; the harness lane imports. Extend by adding, never by removing.
 * Lists are lowercase. Matching is whole-token, never substring.
 */

/** Units that make a number an "amount". Longest first is applied by the tokenizer, order here does not matter. */
export const UNITS = [
  'mg', 'mcg', 'µg', 'ug', 'g', 'kg', 'ml', 'l', 'iu', 'units', 'unit', 'puffs', 'puff', 'drops', 'drop',
  'tablets', 'tablet', 'pills', 'pill', 'caps', 'capsules', 'capsule', 'tsp', 'tbsp', '%', 'x', 'times', 'time',
  'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year', 'hours', 'hour', 'hrs', 'hr',
  'minutes', 'minute', 'mins', 'min', 'seconds', 'second', 'secs', 'sec', 'pm', 'am', 'st', 'nd', 'rd', 'th',
] as const;

export const NUMBER_WORDS = [
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety', 'hundred', 'thousand', 'dozen', 'half', 'once', 'twice', 'thrice',
] as const; // "one" is deliberately absent: it is too common ("one question at a time", "no one")

/** Phrases that state a time span or point the user did not give. */
export const RELATIVE_TIME = [
  'yesterday', 'last week', 'last month', 'last year', 'last night', 'a week', 'a month', 'a year', 'a day',
  'every day', 'every week', 'every night', 'every morning', 'daily', 'weekly', 'monthly',
] as const;

export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
] as const;
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** Medicines a pretend clinician or a rewritten sentence must not introduce on its own. Add generously. */
export const COMMON_DRUGS = [
  'ibuprofen', 'advil', 'motrin', 'acetaminophen', 'paracetamol', 'tylenol', 'aspirin', 'naproxen', 'aleve', 'diclofenac',
  'metformin', 'insulin', 'lisinopril', 'amlodipine', 'atorvastatin', 'simvastatin', 'losartan', 'metoprolol', 'warfarin',
  'omeprazole', 'pantoprazole', 'amoxicillin', 'penicillin', 'azithromycin', 'doxycycline', 'ciprofloxacin', 'cephalexin',
  'prednisone', 'sertraline', 'zoloft', 'fluoxetine', 'prozac', 'escitalopram', 'lexapro', 'citalopram', 'paroxetine',
  'bupropion', 'venlafaxine', 'duloxetine', 'trazodone', 'mirtazapine', 'lithium', 'lamotrigine', 'valproate', 'quetiapine',
  'risperidone', 'aripiprazole', 'olanzapine', 'methylphenidate', 'ritalin', 'adderall', 'amphetamine', 'atomoxetine',
  'guanfacine', 'clonidine', 'melatonin', 'lorazepam', 'ativan', 'alprazolam', 'xanax', 'diazepam', 'valium', 'clonazepam',
  'gabapentin', 'pregabalin', 'tramadol', 'codeine', 'oxycodone', 'morphine', 'hydrocodone', 'sumatriptan', 'albuterol',
  'cetirizine', 'loratadine', 'benadryl', 'diphenhydramine', 'montelukast', 'levothyroxine', 'cannabis', 'cbd',
  'panadol', 'percocet', 'hydroxychloroquine', 'excedrin', 'nurofen', 'voltaren', 'zyrtec', 'claritin', 'prilosec', 'nexium', 'zantac', 'imodium', 'lipitor', 'ozempic', 'wegovy', 'viagra', 'cialis', 'oxycontin', 'vicodin', 'dilaudid', 'suboxone', 'methadone', 'prednisolone', 'dexamethasone', 'hydrocortisone', 'ranitidine', 'famotidine', 'fexofenadine', 'ventolin', 'salbutamol', 'amitriptyline', 'propranolol', 'buspirone', 'hydroxyzine', 'modafinil', 'vyvanse', 'lisdexamfetamine', 'dexamfetamine', 'dextroamphetamine', 'concerta', 'strattera', 'ketamine', 'codamol', 'cocodamol', 'metoclopramide', 'ondansetron', 'loperamide', 'gaviscon', 'benzonatate', 'sildenafil',
] as const;

/** Conditions a pretend clinician must never tell the user they have. */
export const CONDITIONS = [
  'cancer', 'tumor', 'tumour', 'diabetes', 'prediabetes', 'adhd', 'add', 'autism', 'asd', 'depression', 'anxiety',
  'bipolar', 'schizophrenia', 'ocd', 'ptsd', 'epilepsy', 'seizures', 'migraine', 'migraines', 'asthma', 'copd',
  'hypertension', 'hypotension', 'anemia', 'anaemia', 'arthritis', 'osteoporosis', 'lupus', 'fibromyalgia', 'eczema',
  'psoriasis', 'infection', 'sepsis', 'pneumonia', 'bronchitis', 'covid', 'flu', 'influenza', 'strep', 'hepatitis',
  'hiv', 'aids', 'herpes', 'tuberculosis', 'meningitis', 'concussion', 'stroke', 'aneurysm', 'angina', 'arrhythmia',
  'heart disease', 'heart failure', 'heart attack', 'kidney disease', 'kidney stones', 'gallstones', 'appendicitis',
  'ulcer', 'ibs', 'crohn', 'colitis', 'celiac', 'reflux', 'gerd', 'hernia', 'thyroid', 'hypothyroidism', 'hyperthyroidism',
  'sleep apnea', 'insomnia', 'dementia', 'alzheimer', 'parkinson', 'multiple sclerosis', 'eating disorder', 'anorexia',
  'bulimia', 'panic disorder', 'panic attacks', 'burnout', 'long covid', 'pcos', 'endometriosis', 'tendonitis',
] as const;

/** Everyday names for conditions that CONDITIONS lacks. The advice guard treats them like CONDITIONS. */
export const EXTRA_CONDITIONS = [
  "high blood pressure", "low blood pressure", "high cholesterol", "low iron", "iron deficiency", "anemic", "depressed", "anxious",
  "bipolar disorder", "panic attack", "panic attacks", "stress", "stressed", "vitamin d deficiency", "underactive thyroid",
  "overactive thyroid", "irritable bowel", "food poisoning", "kidney infection", "chronic fatigue", "sleep disorder",
  "hormonal imbalance", "hormone imbalance", "heart condition", "blood clot", "dehydration", "malnutrition", "obesity", "diabetic",
  "autistic", "asthmatic", "epileptic", "prediabetic", "overweight",
  "glaucoma", "cataracts", "scoliosis", "shingles", "vertigo", "dyslexia", "dyslexic", "dyscalculia", "dyspraxia", "tourette", "tourettes",
  "learning disability", "slipped disc", "lactose intolerant", "lactose intolerance", "acne", "tonsillitis", "sinusitis", "strep throat", "gout",
  "osteoarthritis", "rheumatoid arthritis", "cystic fibrosis", "sickle cell", "leukemia", "lymphoma", "melanoma", "glandular fever", "measles",
  "chickenpox", "mumps", "whooping cough", "rubella", "malaria", "lyme disease", "tinnitus", "hearing loss", "dermatitis", "rosacea", "vitiligo",
  "alopecia", "narcolepsy", "restless legs", "personality disorder", "social anxiety", "agoraphobia", "phobia", "psychosis", "paranoia",
  "sleep apnoea", "hay fever", "eczema", "diabetes type 2", "type 1 diabetes", "type 2 diabetes", "high blood sugar", "low blood sugar"
] as const;

export const STOPWORDS = [
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has',
  'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did', 'get', 'let', 'say', 'she',
  'too', 'use', 'that', 'this', 'with', 'have', 'from', 'your', 'will', 'then', 'they', 'what', 'when', 'about', 'been',
  'were', 'which', 'their', 'there', 'would', 'could', 'should', 'into', 'than', 'them', 'some', 'very', 'just', 'also',
  'because', 'while', 'where', 'these', 'those', 'does', 'doing', 'done', 'much', 'many', 'more', 'most', 'such', 'only',
  'over', 'under', 'again', 'still', 'even', 'ever', 'each', 'both', 'being', 'make', 'made', 'want', 'like', 'know',
  'need', 'help', 'tell', 'ask', 'please', 'thank', 'thanks', 'okay', 'yes', 'hello', 'doctor', 'visit', 'today',
] as const;

/** Words that may start a sentence without being a name. Capitalised words outside this set at sentence start are still checked against the drug/month/weekday lists. */
export const SENTENCE_STARTERS = [
  'i', 'the', 'a', 'an', 'what', 'why', 'how', 'when', 'where', 'who', 'which', 'please', 'can', 'could', 'do', 'does',
  'is', 'are', 'will', 'would', 'should', 'thank', 'thanks', 'hello', 'hi', 'okay', 'yes', 'no', 'sorry', 'my', 'it',
  'this', 'that', 'we', 'you', 'if', 'and', 'but', 'so', 'then', 'also', 'maybe', 'sometimes', 'often', 'lying', 'they', 'first', 'before', 'after', 'usually', 'mostly', 'there', 'now',
] as const;

export const toSet = <T extends string>(list: readonly T[]): ReadonlySet<string> => new Set<string>(list);
