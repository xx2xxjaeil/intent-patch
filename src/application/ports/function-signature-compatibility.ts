/**
 * Checks whether the current callable type still accepts all previously published calls.
 * Undefined means the available signature evidence cannot establish compatibility.
 */
export interface FunctionSignatureCompatibility {
  preservesPreviousCalls(
    previous: readonly string[],
    current: readonly string[],
  ): boolean | undefined;
}
