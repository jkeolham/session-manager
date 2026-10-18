const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { renderMarkdown } = require('../media/chat');

const sample = `### 1. 예보점 대조 분석 (영흥도 남쪽 5km)

영흥도 남쪽 5km는 기본 설정된 \`20LTC04\` 보다 \`16LTC02\`에 훨씬 가깝습니다.

| 시간대 | 영흥도서측 ( \`20LTC04\` , 10.6km) | 인천동수도입구 ( \`16LTC02\` , 3.6km) | 판정 및 전략 |
|:---|:---|:---|:---|
| 현재 (05:00) | 북북동 0.92kt (상승) | 북북동 0.76kt (상승) | 들물 진행, 갑오징어 스윗스팟 진입 |
| 05:40~05:50 | 북북동 0.98kt (피크) | 북북동 0.80kt (피크) | 들물 최강 구간이나 1노트 안팎으로 매우 양호 |
| 06:50 (★피딩) | 북 0.85kt (하강) | 북 0.77kt (하강) | 일출(06:43) 직후 박명 피딩 + 스윗스팟 |

> 동수도입구 기준 특징: 영흥도 서측 개방 해역 대비 유속 피크가 부드럽게 흐릅니다.

## 로드별 채비 분리 운용 전략 분석

| 로드 + 릴 | 채비 | 봉돌 | 기대 효과 & 실전 운용 |
|:---|:---|:---|:---|
| Zoro 145H<br>+ 라이거30 (6.8) | 자작 귀신채비<br>(에스테르 5호 + 한뼘 목줄) | 10 ~ 14호 | 평시 / 얕은 수심 / 잔잔한 조류: 이미 손에 가장 익은 주력 세팅. |

> [!TIP]
> **서욱짱 채비 캐스팅 주의사항 (10/10 조행 교훈)**:
>
> 서욱짱 채비는 귀신채비와 봉돌·에기 간의 무게중심 밸런스가 달라 캐스팅 시 순간적인 백래시가 생길 수 있습니다.`;

const html = renderMarkdown(sample);

// Assert table container and table tag
assert(html.includes('<div class="table-container">'), 'Should contain .table-container');
assert(html.includes('<table class="chat-table">'), 'Should contain .chat-table');
assert(html.includes('<thead><tr>'), 'Should contain thead');
assert(html.includes('<tbody><tr>'), 'Should contain tbody');

// Assert headers and alignments
assert(html.includes('<th style="text-align:center;">시간대</th>'), 'Metric header should be centered');
assert(html.includes('<th style="text-align:left;">판정 및 전략</th>'), 'Narrative header should be left aligned');
assert(html.includes('<code class="code-pill">20LTC04</code>'), 'Header cell should render code pill');

// Assert table data rows
assert(html.includes('<td style="text-align:center;">현재 (05:00)</td>'), 'Metric data row cell should be centered');
assert(html.includes('<td style="text-align:center;">북북동 0.92kt (상승)</td>'), 'Metric velocity cell should be centered');

// Assert table cell <br/> unescaped
assert(html.includes('Zoro 145H<br/>+ 라이거30 (6.8)'), 'Table cell should render unescaped <br/> tag');
assert(!html.includes('&lt;br&gt;'), 'No escaped &lt;br&gt; should exist in table');

// Assert GitHub Alert callout (Antigravity benchmark)
assert(html.includes('<div class="chat-alert alert-tip">'), 'Should render .chat-alert.alert-tip');
assert(html.includes('<div class="alert-type">TIP</div>'), 'Should render alert type header TIP');
assert(html.includes('서욱짱 채비 캐스팅 주의사항'), 'Alert content should be rendered');

// Assert blockquote and headings
assert(html.includes('<h3 class="chat-h3">1. 예보점 대조 분석 (영흥도 남쪽 5km)</h3>'), 'Heading rendered');
assert(html.includes('<blockquote class="chat-quote">'), 'Standard blockquote rendered');

// Assert no malformed paragraph wrapping around table
assert(!html.includes('<p class="chat-p"><div class="table-container">'), 'Table container should not be wrapped in p');

// Assert CSS styles
const cssPath = path.join(__dirname, '../media/chat.css');
const css = fs.readFileSync(cssPath, 'utf8');
assert(css.includes('.table-container'), 'chat.css must define .table-container');
assert(css.includes('.chat-table'), 'chat.css must define .chat-table');
assert(css.includes('blockquote.chat-quote'), 'chat.css must define blockquote.chat-quote');
assert(css.includes('.chat-alert'), 'chat.css must define .chat-alert');
assert(css.includes('body.is-sidebar'), 'chat.css must define body.is-sidebar');

console.log('✅ test-table-rendering passed!');
