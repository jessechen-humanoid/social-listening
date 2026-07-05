// Spec "Stage failure threshold" / "Light task completion failure threshold":
// a run fails when its errored rows exceed 1% of input rows (ceiling).
// Zero-input runs never trigger the threshold.
export function exceedsErrorThreshold(errors: number, input: number): boolean {
  if (input <= 0) return false;
  return errors > Math.ceil(input * 0.01);
}
