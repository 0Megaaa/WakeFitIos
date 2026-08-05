import { createChallengeFlow } from '../../domain/challenge/challengeFlow.ts';
import type { ChallengeFlowOptions } from '../../domain/challenge/types.ts';

type ChallengeFlow = ReturnType<typeof createChallengeFlow>;

export type StartChallengeOptions = ChallengeFlowOptions;

export function startChallenge(options: StartChallengeOptions): ChallengeFlow {
  return createChallengeFlow(options);
}