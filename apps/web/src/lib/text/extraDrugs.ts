/**
 * Medicine names the shared list (features/shared/lists.ts COMMON_DRUGS) does not have. Lowercase, plain data.
 * The features lane uses it in the grounding check; the harness advice guard imports only shared/lists.ts, so the
 * orchestrator should merge these into COMMON_DRUGS there (see the fix handoff report).
 */
export const EXTRA_DRUGS: readonly string[] = [
  "panadol", "percocet", "hydroxychloroquine", "excedrin", "nurofen", "voltaren", "zyrtec", "claritin", "prilosec", "nexium",
  "zantac", "imodium", "lipitor", "ozempic", "wegovy", "viagra", "cialis", "oxycontin", "vicodin", "dilaudid", "suboxone",
  "methadone", "prednisolone", "dexamethasone", "hydrocortisone", "ranitidine", "famotidine", "fexofenadine", "ventolin",
  "salbutamol", "amitriptyline", "propranolol", "buspirone", "hydroxyzine", "modafinil", "vyvanse", "lisdexamfetamine",
  "dexamfetamine", "dextroamphetamine", "concerta", "strattera", "ketamine", "codamol", "cocodamol", "metoclopramide",
  "ondansetron", "loperamide", "gaviscon", "benzonatate", "sildenafil",
];
