import type { ChangeSet } from "../../domain/change.js";
import type { AnalysisTarget } from "../../domain/report.js";

/**
 * 변경사항을 가져오는 출력 포트다.
 * 애플리케이션 계층은 이 인터페이스만 알기 때문에 Git 외의 데이터 소스도 교체할 수 있다.
 */
export interface ChangeSource {
  collect(target: AnalysisTarget): Promise<ChangeSet>;
}
