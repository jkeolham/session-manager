# Antigravity IDE Session Manager (`ttolmany.session-manager`)

> **N100 서버의 활성 tmux 및 Antigravity(`agy`) CLI 세션을 사이드바에서 한눈에 모니터링하고 원클릭으로 화면에 접속하는 Antigravity IDE 전용 확장**

---

## 🌟 주요 기능 (Features)

1. **Activity Bar 통합**:
   - 좌측 액티비티 바에 전용 `Sessions` 아이콘 제공
2. **자동 분류 & 지능형 한글 대화 타이틀 매핑**:
   - 🟢 **Antigravity CLI (`agy_*`)**: `conversation_summaries.db`를 실시간 조회하여 세션명뿐만 아니라 실제 대화 주제(예: `JKNAS 뮤직라이브러리`, `헤드리스 시스템 개발` 등)를 부제목으로 표시
   - 🟣 **Claude Code 세션**: `Tax_Asset`, `Fishing`, `Hojak` 등 기존 레거시 세션 자동 분류
   - 🔵 **Codex 세션**: `codex_jknas_music` 등 전용 분류
   - ⚪ **기타 세션**: 일반 백그라운드 셸/스크립트 세션
3. **원클릭 터미널 접속**:
   - 세션 클릭 시 IDE 내장 터미널에 `tmux: <세션명>` 탭을 생성하고 `tmux attach-session`으로 즉시 연결
   - 이미 열려 있는 세션 탭이 있다면 새 터미널을 중복 생성하지 않고 기존 터미널로 즉시 포커스 이동
4. **상단 툴바 액션**:
   - 🔄 **새로고침 (Refresh)**: 세션 목록 즉시 갱신 (기본 30초 주기 자동 갱신 지원)
   - ➕ **새 AGY 세션 생성 (New AGY Session)**: 프롬프트에 주제명을 입력하면 새 `agy_<이름>` tmux 세션을 생성하고 즉시 화면에 접속
   - 🗑️ **세션 종료 (Kill Session)**: 마우스 우클릭 컨텍스트 메뉴를 통해 안전하게 세션 종료

---

## 📂 파일 구조 (Structure)

```
session-manager/
├── package.json               # VS Code 확장 매니페스트
├── extension.js               # TreeDataProvider, 터미널 컨트롤러, 커맨드 정의
├── session-discovery.js       # tmux list-panes 파싱 및 SQLite 대화 타이틀 조회 엔진
├── media/
│   └── icon.svg               # 액티비티 바 전용 아이콘
├── test/
│   └── test-discovery.js      # 세션 수집 및 타이틀 매핑 자동 검증 테스트
├── LICENSE                    # MIT License
└── session-manager-1.0.0.vsix # 배포용 VSIX 패키지
```

---

## 🚀 설치 및 적용 방법 (Installation)

### 방법 1: Antigravity IDE 서버 디렉터리에 직접 설치 (권장)
```bash
mkdir -p ~/.antigravity-ide-server/extensions/ttolmany.session-manager-1.0.0
cp -r * ~/.antigravity-ide-server/extensions/ttolmany.session-manager-1.0.0/
```

### 방법 2: Command Palette에서 재로드
1. IDE에서 `Ctrl + Shift + P` (또는 `F1`)를 누릅니다.
2. `Developer: Reload Window`를 실행합니다.
3. 좌측 액티비티 바에 **Sessions** 아이콘이 나타납니다.

---

## 🛠️ 요구사항 (Prerequisites)
- Linux 호스트 (`tmux` 설치 필요)
- Antigravity IDE 또는 VS Code Server
- Node.js v18+ (런타임 기본 내장)
- Python 3 (대화 DB 읽기용 경량 헬퍼)

---

## 📄 라이선스 (License)
MIT License
