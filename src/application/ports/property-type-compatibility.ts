/** 기존 객체 타입에 선택 필드만 더해졌는지 보수적으로 판정한다. */
export interface PropertyTypeCompatibility {
  preservesOptionalObjectExtensions(previous: string, current: string): boolean;
}
