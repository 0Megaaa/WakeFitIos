export type CameraPresentationState = {
  realCameraEnabled: boolean;
  alarmModalVisible: boolean;
};

export function shouldRenderInlineCamera(state: CameraPresentationState): boolean {
  return state.realCameraEnabled && !state.alarmModalVisible;
}

export function shouldUseCameraFirstChallengeLayout(
  state: Pick<CameraPresentationState, 'realCameraEnabled'>,
): boolean {
  return state.realCameraEnabled;
}