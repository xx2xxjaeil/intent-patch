import type { ChangeReport } from "../../domain/report.js";
import { formatHtmlReport } from "../html/html-report.js";
import type { OutputFormat } from "./arguments.js";
import { formatTextReport } from "./text-report.js";

/** 모든 출력 형식이 동일한 ChangeReport를 사용하도록 포맷 선택을 한곳에 모은다. */
export function formatReport(report: ChangeReport, format: OutputFormat): string {
  switch (format) {
    case "text":
      return formatTextReport(report);
    case "json":
      return `${JSON.stringify(report, null, 2)}\n`;
    case "html":
      return formatHtmlReport(report);
  }
}
