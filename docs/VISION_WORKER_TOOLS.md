# 미래 비전: 워커 도구 사용

> 2026-03-19 작성. 현재 미구현, 향후 검토용.

## 배경

현재 워커는 도구 없이 학습 데이터만으로 응답한다. 그러나 최신 데이터가 핵심인 주제에서 할루시네이션 위험이 있다.

## 확인된 사실

- `claude -p`에서 `--tools "WebSearch,WebFetch,Read,Grep,Glob" --strict-mcp-config`로 안전한 도구만 허용 가능
- `--max-turns` 미지정 시 필요한 만큼 턴 사용 가능
- 도구 사용 시 워커당 비용 ~$0.25 (도구 없을 때 ~$0.008, 약 30배)
- `--strict-mcp-config` 없이 `--tools`만 쓰면 MCP 도구(pyreez 재귀 호출)가 차단되지 않음
- 도구 사용 가능한 provider는 현재 `claude -p`(Anthropic)뿐. API 기반 provider는 chat completion만 지원

## 미결 사항

- 주제/도메인에 따라 도구 사용 여부를 자동 판단하는 기준
- Anthropic 워커만 도구를 쓸 수 있는 비대칭 허용 여부
- 비용 대비 품질 향상의 정량적 측정
- 도구 사용 워커의 응답 시간 증가 (4턴 = 지연 4배)
- models.json에 per-model 도구 설정 필드 추가 여부

## claude -p 빈 응답 원인 (해결됨)

- 원인: `--tools` 미지정 시 Claude Code 에이전트 모드로 동작 → 도구만 호출하다 텍스트 없이 종료 (`stop_reason: "tool_use"`, `subtype: "error_max_turns"`)
- 수정: `--tools ""`로 도구 비활성화 (현재 적용)
- 향후: 도구 허용 시 `--tools "허용목록" --strict-mcp-config`로 전환
