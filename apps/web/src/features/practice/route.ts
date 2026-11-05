import { practiceSpec } from './spec';

/** Inject Rudheer's runTask here; no second provider or security harness is implemented. */
export function createPost(runTask: (spec: typeof practiceSpec, req: Request) => Promise<Response>) {
  return (req: Request): Promise<Response> => runTask(practiceSpec, req);
}
