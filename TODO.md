T8 benchmark loadPrompts — 구조적 미구현. index.ts 95행에서 throw new Error("No prompt source configured"). 평가 프롬프트 JSON/JSONL 파일을 만들고 loadPrompts를 실제 파일 로더로 교체해야 함.

T6 deliberate — LLM API 예산 한도. 예산 충전 후 재실행 가능.

T1 route — MCP 서버가 구 코드(f41efeb 이전)로 실행 중. VS Code Command Palette → MCP: Restart Server 또는 mcp.json 재저장으로 재시작 필요.

블라킹 무한대기시 태스크 취소해야됨