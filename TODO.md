# TODO — pyreez

> 배포/문서화 제외. 코어 기능 + 품질 개선만.

## P0 — 피드백 루프 완성

- [x] `.pyreez/` gitignore 해제 → 런타임 데이터 git tracking
- [x] `calibrate()` 결과를 `scores/models.json`에 persist하는 코드 구현
- [x] `models.json` V1→V2 마이그레이션 (소스 자체를 BT `{mu, sigma, comparisons}` 포맷으로)
- [x] `pyreez_calibrate` MCP 도구 신설 — 호스트가 calibration 트리거 가능하도록
- [x] 숙의 `deliberationLog` 영속화 — `FileDeliberationStore.save()`에 라운드별 전체 대화(생산→리뷰→합성) 시퀀셜 로깅 추가 (현재 요약만 저장, 원본 대화 유실)

## P1 — 데이터 품질

- [x] 벤치마크 자동화 — 수동 점수 입력 → 자동 측정 파이프라인
- [ ] 프로파일러 한국어 토큰 팽창 실측 보정

## P2 — 숙의 품질 개선

- [x] 숙의 합의 도달률 개선 — 프롬프트/라운드 전략 조정 (현재 3건 중 1건만 합의)
- [ ] rate limit 재시도 전략 강화 (DeepSeek 등 외부 API)
