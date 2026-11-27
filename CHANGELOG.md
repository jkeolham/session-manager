# Session Manager Changelog

## [v1.3.52] - 2026-11-27
### ⚡ 기준 agy 버전: v1.5.18
- **질문 선택지(Ask Question) 모바일 탭 인터랙션 전면 개편**:
  - CSS `:has` 단독 의존에서 탈피, JS 클릭/탭 레벨에서 input checked 및 `.selected` 명시적 클래스 동기화(`syncQuestionOptionStates`)로 모바일에서 즉각적인 파란색 테두리 및 발광 하이라이트 보장
  - 단일 선택 라디오 시 `(Recommended)` 인덱스 우선 판정으로 다중 체크 충돌 원천 차단
- **다중 질문(Multi-question) 단일 카드 통합 지원**:
  - `ask_question`의 questions가 2개 이상일 때 개별 카드로 쪼개지지 않고 단일 카드 내 질문별 섹션(`.question-section`, `Q1.`, `Q2.`)으로 묶어 배치
  - 하단 단일 `[Submit]` 버튼으로 모든 질문의 응답 배열(`responses: [...]`) 일괄 취합 제출
- **LaTeX 수식 렌더러 내 셸 변수 및 URL 예외 처리**:
  - `$src_dir/$name`, `http://$host:$port` 등 셸 변수/경로 패턴이 LaTeX 수식으로 오인 변환되어 깨지던 현상 방지
- **코드 블록 복사 시 공백 및 빈 줄 보존**:
  - `copyCodeBlock`에서 `codeEl.textContent`를 우선 사용하여 브라우저 innerText의 연속 빈 줄 축소 버그 방지
- **agy 대시보드 자동 동기화 스킬(`sync-agy-dashboard`) 탑재**:
  - 최신 agy changelog를 파싱하여 UI/대시보드 관련 변경점을 자동 분류하고 세션 매니저 패치 가이드를 제공하는 스킬 및 도구 구축

## [v1.3.51] - 2026-11-26
- **한글 파일명 다운로드 500 오류 해결**:
  - Node.js HTTP 헤더 `TypeError [ERR_INVALID_CHAR]` 예외 방지
  - RFC 6266 / RFC 5987 표준 규격 준수: `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`
- **모바일 Blob 다운로드 엔진 구축**:
  - `fetch` -> `Blob` -> `URL.createObjectURL` 가상 다운로드 트리거로 모바일 브라우저 및 PWA 환경에서 파일명 보존 100% 보장

## [v1.3.50] - 2026-11-25
- **코드 블록 원클릭 복사 기능 강화**:
  - 모바일 터치 시 코드 블록 우측 상단 `[복사]` 버튼 클릭 이벤트 연동 및 fallback 클립보드 복사 엔진 탑재

## [v1.3.49] - 2026-11-24
- **메시지 롱프레스 컨텍스트 메뉴 및 인용 답장(Reply)**:
  - 모바일 터치 롱프레스 제스처로 복사, 답장, TTS 메뉴 팝업 노출
  - 이전 어시스턴트 답변을 인용하여 이어서 대화할 수 있는 Reply 바 제공

## [v1.3.48] - 2026-11-22
- **원터치 퀵 칩 바 (Quick Chips Bar)**:
  - 컴포저 상단에 자주 사용하는 한국어 명령 칩(점검, 요약, 파일찾기 등) 토글 바 제공

## [v1.3.46] - 2026-11-21
- **대시보드 v2.31 리디자인 & 음성 모드 (Voice Mode) & N100 자동화 센터**:
  - 음성 마이크 딕테이션 기능 탑재
  - N100 호스트 crontab 및 서비스 자동화 모니터링 센터 모달 연동
